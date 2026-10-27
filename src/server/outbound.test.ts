import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { isAllowedUrl, outboundFetch, OutboundRefusedError } =
  await import('./outbound')

describe('isAllowedUrl', () => {
  it.each([
    'https://api.github.com/user/installations',
    'https://api.github.com/repos/octo/repo/commits?per_page=100',
    'https://api.resend.com/emails',
    'https://github.com/login/oauth/access_token',
  ])('allows %s', (url) => {
    expect(isAllowedUrl(url)).toBe(true)
  })

  it.each([
    ['another host', 'https://example.com/'],
    ['a lookalike host', 'https://api.github.com.evil.test/'],
    ['a lookalike prefix', 'https://evilapi.github.com/'],
    ['a subdomain', 'https://uploads.github.com/'],
    ['http', 'http://api.github.com/'],
    ['credentials in the URL', 'https://user:pass@api.github.com/'],
    ['a username only', 'https://user@api.github.com/'],
    ['a port', 'https://api.github.com:8443/'],
    ['the internal metadata address', 'http://169.254.169.254/latest/'],
    ['localhost', 'https://localhost/'],
    ['a protocol-relative string', '//api.github.com/'],
    ['a relative path', '/user'],
    ['an empty string', ''],
    [
      'github.com outside the token path',
      'https://github.com/login/oauth/authorize',
    ],
    ['github.com root', 'https://github.com/'],
    [
      'a path trick on the token path',
      'https://github.com/login/oauth/access_token/../authorize',
    ],
    [
      'an encoded path trick',
      'https://github.com/login/oauth/access_token%2f..%2fauthorize',
    ],
    ['a prototype key as host', 'https://__proto__/'],
    ['a constructor host', 'https://constructor/'],
  ])('refuses %s', (_label, url) => {
    expect(isAllowedUrl(url)).toBe(false)
  })
})

describe('outboundFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses a host that is not allowed, without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      outboundFetch('https://example.com/steal'),
    ).rejects.toBeInstanceOf(OutboundRefusedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not put the URL, which can hold a token, in the error', async () => {
    const secret = 'ghs_secrettoken'
    const message = await outboundFetch(
      `https://example.com/?access_token=${secret}`,
    ).then(
      () => '',
      (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
    )
    expect(message).not.toBe('')
    expect(message).not.toContain(secret)
    expect(message).not.toContain('example.com')
  })

  it('calls an allowed host, refusing redirects and with a timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await outboundFetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer x' },
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/user')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers).toEqual({ Authorization: 'Bearer x' })
  })
})
