import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))

const { recordSignInAndAlert } = await import('./sign-in-alert')

const config = {
  RESEND_API_KEY: 'k',
  EMAIL_FROM: 'a@b.co',
  DEVICE_HASH_SALT: 'a-long-enough-test-salt',
}

const info = {
  userId: 'user-1',
  email: 'ada@example.com',
  method: 'email' as const,
  userAgent: 'Mozilla/5.0 Firefox/132.0',
  ip: '203.0.113.7',
}

const record = vi.fn()
const send = vi.fn()
const logFailure = vi.fn()
const getConfig = vi.fn()

const deps = () => ({
  config: getConfig,
  record,
  send,
  now: () => new Date('2026-10-26T12:00:00Z'),
  logFailure,
})

describe('recordSignInAndAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConfig.mockReturnValue(config)
    send.mockResolvedValue(undefined)
  })

  it('sends nothing on a first sign-in or a known device', async () => {
    record.mockResolvedValue({ alert: false, eventId: 'e1' })
    await recordSignInAndAlert(info, deps())
    expect(record).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends one alert on a new device', async () => {
    record.mockResolvedValue({ alert: true, eventId: 'e2' })
    await recordSignInAndAlert(info, deps())
    expect(send).toHaveBeenCalledExactlyOnceWith({
      to: 'ada@example.com',
      eventId: 'e2',
      at: new Date('2026-10-26T12:00:00Z'),
      method: 'email',
      browser: 'Firefox',
    })
  })

  it('does nothing at all while alerts are off', async () => {
    getConfig.mockReturnValue(null)
    await recordSignInAndAlert(info, deps())
    expect(record).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('stores only a truncated IP, a browser family and a hash', async () => {
    record.mockResolvedValue({ alert: false, eventId: 'e1' })
    await recordSignInAndAlert(info, deps())
    const stored = JSON.stringify(record.mock.calls[0]?.[0])
    expect(stored).not.toContain('203.0.113.7')
    expect(stored).toContain('203.0.113.0/24')
    expect(stored).not.toContain('Mozilla')
  })

  it('never asks for an alert when the user has no email', async () => {
    record.mockResolvedValue({ alert: false, eventId: 'e1' })
    await recordSignInAndAlert({ ...info, email: null }, deps())
    expect(record.mock.calls[0]?.[0]).toMatchObject({ allowAlert: false })
  })

  it('swallows a send failure and logs only the stage', async () => {
    record.mockResolvedValue({ alert: true, eventId: 'e2' })
    send.mockRejectedValue(new Error('boom for ada@example.com'))
    await expect(recordSignInAndAlert(info, deps())).resolves.toBeUndefined()
    expect(logFailure).toHaveBeenCalledExactlyOnceWith('send')
  })

  it('swallows a record failure too', async () => {
    record.mockResolvedValue(null)
    await expect(recordSignInAndAlert(info, deps())).resolves.toBeUndefined()
    expect(logFailure).toHaveBeenCalledExactlyOnceWith('record')
    expect(send).not.toHaveBeenCalled()
  })
})
