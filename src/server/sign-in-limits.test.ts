import { beforeEach, describe, expect, it, vi } from 'vitest'

const rateLimit = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./rate-limit', () => ({ rateLimit }))

const { allowEmailLink, allowSignInStart, emailKey } =
  await import('./sign-in-limits')

describe('sign-in limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimit.mockResolvedValue(true)
  })

  it('never puts a raw email in a limiter key', async () => {
    await allowEmailLink('203.0.113.7', 'Ada@Example.com')
    const keys = rateLimit.mock.calls.map((call) => String(call[1]))
    expect(keys.join()).not.toMatch(/ada|example|@/i)
  })

  it('treats case and spaces in an email as the same key', () => {
    expect(emailKey(' Ada@Example.com ')).toBe(emailKey('ada@example.com'))
  })

  it('blocks when either the IP or the email limit is hit', async () => {
    rateLimit.mockImplementation((name: string) =>
      Promise.resolve(name !== 'emailLinkEmail'),
    )
    expect(await allowEmailLink('1.2.3.4', 'a@b.co')).toBe(false)
    rateLimit.mockImplementation((name: string) =>
      Promise.resolve(name !== 'emailLinkIp'),
    )
    expect(await allowEmailLink('1.2.3.4', 'a@b.co')).toBe(false)
  })

  it('uses the sign-in-start limit by IP', async () => {
    await allowSignInStart('1.2.3.4')
    expect(rateLimit).toHaveBeenCalledWith('signInStartIp', '1.2.3.4')
  })
})
