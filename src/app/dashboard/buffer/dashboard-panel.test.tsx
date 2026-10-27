import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUFFER_FLASH,
  BUFFER_FLASH_MESSAGES,
  BUFFER_REVOKE_NOTE,
  parseBufferFlash,
  withBufferFlash,
} from '@/lib/buffer-flash'

const schedulingIsEnabled = vi.fn()
const getConnectionStatus = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/server/scheduling', () => ({ schedulingIsEnabled }))
vi.mock('@/server/scheduled-posts', () => ({ getConnectionStatus }))
vi.mock('./actions', () => ({
  connectBufferAction: vi.fn(),
  disconnectBufferAction: vi.fn(),
}))

const { BufferDashboardPanel } = await import('./dashboard-panel')

async function render(
  flash: Parameters<typeof BufferDashboardPanel>[0]['flash'] = null,
) {
  const element = (await BufferDashboardPanel({ flash })) as ReactElement | null
  if (element === null) return ''
  const stream = await renderToReadableStream(element)
  await stream.allReady
  return (await new Response(stream).text()).replaceAll('<!-- -->', '')
}

beforeEach(() => {
  vi.clearAllMocks()
  schedulingIsEnabled.mockReturnValue(true)
  getConnectionStatus.mockResolvedValue({ state: 'none', connectedAt: null })
})

describe('the Buffer dashboard panel', () => {
  it('renders nothing while scheduling is off, and reads nothing', async () => {
    schedulingIsEnabled.mockReturnValue(false)
    expect(await render()).toBe('')
    expect(getConnectionStatus).not.toHaveBeenCalled()
  })

  it('offers Connect Buffer when there is no connection, and says nothing is scheduled without Confirm', async () => {
    const html = await render()
    expect(html).toContain('Connect Buffer')
    expect(html).toContain('Nothing is scheduled until you press Confirm.')
    expect(html).not.toContain('Disconnect Buffer')
  })

  it('offers Disconnect and the switch-account note when connected', async () => {
    getConnectionStatus.mockResolvedValue({
      state: 'connected',
      connectedAt: 'x',
    })
    const html = await render()
    expect(html).toContain('Buffer is connected.')
    expect(html).toContain('Disconnect Buffer')
    expect(html).toContain(
      'To use a different Buffer account, disconnect here, sign out of Buffer in this browser',
    )
    expect(html).not.toContain('Reconnect Buffer')
  })

  it('offers Reconnect Buffer as well when it needs it', async () => {
    getConnectionStatus.mockResolvedValue({
      state: 'needs_reconnect',
      connectedAt: 'x',
    })
    const html = await render()
    expect(html).toContain('Buffer needs to be connected again.')
    expect(html).toContain('Reconnect Buffer')
    expect(html).toContain('Disconnect Buffer')
  })

  it('says plainly when the connection cannot be read', async () => {
    getConnectionStatus.mockResolvedValue(null)
    const html = await render()
    expect(html).toContain('We could not load your Buffer connection.')
    expect(html).not.toContain('Connect Buffer')
  })

  it('shows the flash wording for a known code, as an alert when it is bad', async () => {
    const good = await render('connected')
    expect(good).toContain('Buffer connected.')
    expect(good).toContain('role="status"')
    const bad = await render('expired')
    expect(bad).toContain('role="alert"')
    expect(bad).toContain('expired or was already used')
  })

  it('tells the person to remove Shipnote in Buffer after disconnecting', async () => {
    for (const code of ['disconnected', 'disconnected_posts'] as const) {
      const html = await render(code)
      expect(html).toContain(
        'remove Shipnote from the connected apps in your Buffer account settings',
      )
    }
    expect(BUFFER_FLASH_MESSAGES.disconnected_posts.text).toContain(
      'may still publish',
    )
  })
})

describe('the Buffer flash codes', () => {
  it('only a known code is read, and everything else is ignored', () => {
    for (const code of BUFFER_FLASH) expect(parseBufferFlash(code)).toBe(code)
    for (const bad of [
      '',
      'CONNECTED',
      '<script>',
      'constructor',
      '__proto__',
      ['connected'],
      null,
      undefined,
      3,
    ]) {
      expect(parseBufferFlash(bad)).toBeNull()
    }
  })

  it('every code has wording, and the revoke note is never lost', () => {
    for (const code of BUFFER_FLASH) {
      expect(BUFFER_FLASH_MESSAGES[code].text.length).toBeGreaterThan(10)
    }
    expect(BUFFER_REVOKE_NOTE).toContain('Buffer account settings')
  })

  it('adds the code to a same-site path', () => {
    expect(withBufferFlash('/dashboard', 'connected')).toBe(
      '/dashboard?buffer=connected',
    )
    expect(withBufferFlash('/dashboard/projects/x?tab=drafts', 'failed')).toBe(
      '/dashboard/projects/x?tab=drafts&buffer=failed',
    )
  })
})
