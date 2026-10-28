import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const rateLimit = vi.fn()
const saveVoice = vi.fn()
const resetVoice = vi.fn()
const revalidatePath = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/voice', () => ({ saveVoice, resetVoice }))

const { resetVoiceAction, saveVoiceAction } = await import('./actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const IDLE = { status: 'idle' } as const

const form = (fields: Record<string, string | string[]> = {}) => {
  const data = new FormData()
  const all: Record<string, string | string[]> = {
    tone: 'casual',
    notes: 'Short and dry.',
    sample: ['I fixed the thing.', '', ''],
    avoid: 'synergy, leverage',
    signoff: 'Cheers',
    ...fields,
  }
  for (const [name, value] of Object.entries(all)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(name, item)
    }
  }
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  rateLimit.mockResolvedValue(true)
  saveVoice.mockResolvedValue('ok')
  resetVoice.mockResolvedValue('ok')
})

describe('saveVoiceAction', () => {
  it('refuses without a session, before anything else happens', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(saveVoiceAction(IDLE, form())).rejects.toThrow(
      'redirect:/sign-in',
    )
    expect(rateLimit).not.toHaveBeenCalled()
    expect(saveVoice).not.toHaveBeenCalled()
  })

  it('saves the cleaned voice for the signed-in user and refreshes the page', async () => {
    expect(await saveVoiceAction(IDLE, form())).toEqual({ status: 'saved' })
    expect(saveVoice).toHaveBeenCalledExactlyOnceWith(USER, {
      tone: 'casual',
      notes: 'Short and dry.',
      samples: ['I fixed the thing.'],
      avoidWords: ['synergy', 'leverage'],
      signoff: 'Cheers',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/settings/voice')
  })

  it('never takes a user from the form', async () => {
    await saveVoiceAction(
      IDLE,
      form({ userId: 'someone-else', user_id: 'someone-else' }),
    )
    expect(saveVoice.mock.calls[0]?.[0]).toBe(USER)
  })

  it('is rate limited', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await saveVoiceAction(IDLE, form())).toEqual({ status: 'limited' })
    expect(rateLimit).toHaveBeenCalledWith('voiceSave', USER)
    expect(saveVoice).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown tone', { tone: 'sarcastic' }, 'tone'],
    ['notes over 500 characters', { notes: 'n'.repeat(501) }, 'notes'],
    ['a 4th sample', { sample: ['a', 'b', 'c', 'd'] }, 'samples'],
    [
      'a sample over 1,500 characters',
      { sample: ['a'.repeat(1501)] },
      'samples',
    ],
    ['a long avoid word', { avoid: 'w'.repeat(31) }, 'avoid'],
    ['a sign-off with a link', { signoff: 'see example.com' }, 'signoff'],
  ])(
    'refuses %s with a plain message and saves nothing',
    async (_n, fields, field) => {
      const result = await saveVoiceAction(IDLE, form(fields))
      expect(result).toMatchObject({ status: 'invalid', field })
      expect(saveVoice).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['notes', { notes: 'use sk-ant-' + 'a'.repeat(30) }, 'the voice notes'],
    [
      'a sample',
      { sample: ['ok', 'token ghp_' + 'b'.repeat(36), ''] },
      'sample post 2',
    ],
    ['the avoid words', { avoid: 'AKIAABCDEFGHIJKLMNOP' }, 'the avoid words'],
    ['the sign-off', { signoff: 'sk-ant-' + 'c'.repeat(30) }, 'the sign-off'],
  ])(
    'a secret in %s blocks the save, naming where and never the text',
    async (_n, fields, where) => {
      const result = await saveVoiceAction(IDLE, form(fields))
      expect(result.status).toBe('secret')
      const message = result.status === 'secret' ? result.message : ''
      expect(message).toContain(where)
      expect(message).not.toMatch(/aaaa|bbbb|cccc|ABCDEFGH/)
      expect(saveVoice).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    },
  )

  it('reports a failed write, which is also what a soft-deleted account gets', async () => {
    saveVoice.mockResolvedValue('failed')
    expect(await saveVoiceAction(IDLE, form())).toEqual({ status: 'failed' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('never echoes or logs what was typed', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const typed = 'PRIVATE-TYPED-TEXT'
    const results = [
      await saveVoiceAction(IDLE, form({ notes: typed })),
      await saveVoiceAction(IDLE, form({ notes: typed + 'n'.repeat(600) })),
      await saveVoiceAction(
        IDLE,
        form({ notes: typed + ' sk-ant-' + 'a'.repeat(30) }),
      ),
    ]
    saveVoice.mockResolvedValue('failed')
    results.push(await saveVoiceAction(IDLE, form({ notes: typed })))
    expect(JSON.stringify(results)).not.toContain(typed)
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(typed)
  })
})

describe('resetVoiceAction', () => {
  it('refuses without a session', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(resetVoiceAction()).rejects.toThrow('redirect:/sign-in')
    expect(resetVoice).not.toHaveBeenCalled()
  })

  it('deletes the signed-in user’s own profile and refreshes the page', async () => {
    expect(await resetVoiceAction()).toEqual({ status: 'reset' })
    expect(resetVoice).toHaveBeenCalledExactlyOnceWith(USER)
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/settings/voice')
  })

  it('is rate limited, and reports a failure', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await resetVoiceAction()).toEqual({ status: 'limited' })
    rateLimit.mockResolvedValue(true)
    resetVoice.mockResolvedValue('failed')
    expect(await resetVoiceAction()).toEqual({ status: 'failed' })
  })
})
