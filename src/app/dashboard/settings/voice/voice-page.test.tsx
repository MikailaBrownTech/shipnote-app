import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The voice settings page, rendered on the server: what is on it, in each state.

const requireUser = vi.fn()
const readVoice = vi.fn()
const aiIsEnabled = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/voice', () => ({ readVoice }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled }))
vi.mock('./actions', () => ({
  saveVoiceAction: vi.fn(),
  resetVoiceAction: vi.fn(),
}))

const { default: VoicePage } = await import('./page')

// The tone whose radio button is checked.
const checkedTone = (html: string) =>
  [...html.matchAll(/<input[^>]*name="tone"[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('checked=""'))
    .map((tag) => /value="(\w+)"/.exec(tag)?.[1])

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'

async function render() {
  const errors: unknown[] = []
  const stream = await renderToReadableStream(<VoicePage />, {
    onError: (error) => {
      errors.push(error)
    },
  })
  await stream.allReady
  const html = (await new Response(stream).text()).replaceAll('<!-- -->', '')
  return { html, errors }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  aiIsEnabled.mockReturnValue(true)
  readVoice.mockResolvedValue(null)
})

describe('the voice page', () => {
  it('requires a signed-in user and reads only their own voice', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
    expect(readVoice).toHaveBeenCalledExactlyOnceWith(USER)
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    readVoice.mockClear()
    const denied = await render()
    expect(String(denied.errors[0])).toContain('redirect:/sign-in')
    expect(readVoice).not.toHaveBeenCalled()
  })

  it('shows every tone with a description and an example, the default one chosen', async () => {
    const { html } = await render()
    for (const label of [
      'Professional',
      'Academic',
      'Casual',
      'Friendly',
      'Direct',
      'Storyteller',
      'Humble',
    ]) {
      expect(html).toContain(`<strong>${label}</strong>`)
    }
    expect(html.match(/name="tone"/g)).toHaveLength(7)
    expect(checkedTone(html)).toEqual(['professional'])
    expect(html).toContain('This week I reworked how the app stores reports.')
  })

  it('has the notes box, three sample boxes with counters, avoid words and a sign-off', async () => {
    const { html } = await render()
    expect(html).toContain('How do you want to sound?')
    expect(html.match(/name="sample"/g)).toHaveLength(3)
    expect(html).toContain('Sample post 1')
    expect(html).toContain('Sample post 3')
    expect(html).toContain('0 / 500')
    expect(html.match(/0 \/ 1,500/g)).toHaveLength(3)
    expect(html).toContain('Words to avoid')
    expect(html).toContain('Sign-off')
    expect(html).toContain('Posts you wrote')
    expect(html).toContain('Save voice')
    expect(html).toContain('Reset to default')
  })

  it('says that long samples cost slightly more of the monthly pool', async () => {
    const { html } = await render()
    expect(html).toContain(
      'Longer samples use slightly more of the monthly drafting pool.',
    )
  })

  it('says what is sent to Anthropic', async () => {
    const { html } = await render()
    expect(html).toContain(
      'sends your tone, notes, sample posts, words to avoid',
    )
  })

  it('shows the saved voice, and the size it adds', async () => {
    readVoice.mockResolvedValue({
      tone: 'direct',
      notes: 'Blunt and short.',
      samples: ['My first post.'],
      avoidWords: ['synergy', 'leverage'],
      signoff: 'Cheers',
    })
    const { html } = await render()
    expect(checkedTone(html)).toEqual(['direct'])
    expect(html).toContain('Blunt and short.')
    expect(html).toContain('My first post.')
    expect(html).toContain('value="synergy, leverage"')
    expect(html).toContain('value="Cheers"')
    expect(html).toMatch(/adds about [\d,]+ characters/)
  })

  it('shows the user’s text as text, never as markup', async () => {
    readVoice.mockResolvedValue({
      tone: 'casual',
      notes: '</textarea><script>alert(1)</script>',
      samples: ['<img src=x onerror=alert(1)>'],
      avoidWords: [],
      signoff: '"><b>x</b>',
    })
    const { html } = await render()
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>x</b>')
  })

  it('says drafting is off, but still lets the user save', async () => {
    aiIsEnabled.mockReturnValue(false)
    const { html } = await render()
    expect(html).toContain('Drafting is switched off right now.')
    expect(html).toContain('Save voice')
  })

  it('shows a plain error, and no form, if the voice cannot be read', async () => {
    readVoice.mockResolvedValue('failed')
    const { html } = await render()
    expect(html).toContain('We could not load your voice settings.')
    expect(html).not.toContain('Save voice')
  })
})
