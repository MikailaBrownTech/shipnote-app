import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))

const { sendSignInAlert } = await import('./email')
const { buildSignInAlert } = await import('./email-template')

const input = {
  to: 'ada@example.com',
  eventId: 'evt-1',
  at: new Date('2026-10-26T12:00:00Z'),
  method: 'github' as const,
  browser: 'Firefox' as const,
}

describe('sendSignInAlert', () => {
  beforeEach(() => {
    vi.stubEnv('ALERTS_ENABLED', 'true')
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('EMAIL_FROM', 'Shipnote <alerts@shipnote.test>')
    vi.stubEnv('DEVICE_HASH_SALT', 'a-long-enough-test-salt')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('posts to Resend with the key, sender and an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    await sendSignInAlert(input)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer re_test')
    expect(headers['Idempotency-Key']).toBe('sign-in-alert-evt-1')
    const body = JSON.parse(init.body as string) as Record<string, string>
    expect(body.from).toBe('Shipnote <alerts@shipnote.test>')
    expect(body.to).toBe('ada@example.com')
  })

  it('fails closed, naming the variable, when the API key is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendSignInAlert(input)).rejects.toThrow(
      /RESEND_API_KEY is missing/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports only the status when the provider refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('bad address ada@example.com'),
      }),
    )
    const error = await sendSignInAlert(input).catch((e: unknown) => e)
    expect(String(error)).toContain('422')
    expect(String(error)).not.toContain('ada@example.com')
  })
})

describe('buildSignInAlert', () => {
  const email = buildSignInAlert({
    siteUrl: 'https://shipnote.test',
    at: new Date('2026-10-26T12:00:00Z'),
    method: 'github',
    browser: 'Firefox',
  })

  it('says when, how and which browser, and where to sign out everywhere', () => {
    expect(email.text).toContain('2026-10-26 12:00 UTC')
    expect(email.text).toContain('GitHub')
    expect(email.text).toContain('Firefox')
    expect(email.text).toContain('Sign out everywhere')
    expect(email.text).toContain('https://shipnote.test/dashboard')
  })

  it('has exactly one link and it is the dashboard, with no token', () => {
    const links = email.html.match(/href="[^"]*"/g) ?? []
    expect(links).toEqual(['href="https://shipnote.test/dashboard"'])
    expect(email.text).not.toMatch(/[?&](token|code|access_token)=/i)
  })

  it('does not mention a location', () => {
    expect(email.text.toLowerCase()).not.toMatch(/location|city|country|ip /)
  })
})
