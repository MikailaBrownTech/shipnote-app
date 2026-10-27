import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const set = vi.fn()
const store = {
  getAll: () => [
    { name: 'sb-proj-auth-token.0', value: 'a' },
    { name: 'sb-proj-auth-token.1', value: 'b' },
    { name: 'sb-proj-auth-token-code-verifier', value: 'v' },
    { name: 'theme', value: 'dark' },
  ],
  set,
}

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(store) }))

const { clearAuthCookies } = await import('./auth-cookies')
const { rememberNext, nextCookieOptions } = await import('./next-cookie')

describe.each([
  ['production', true],
  ['development', false],
])('cookie writes outside the Supabase client (%s)', (mode, secure) => {
  beforeEach(() => {
    set.mockClear()
    vi.stubEnv('NODE_ENV', mode)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('clears every sb- cookie, chunks and verifier included, with the same flags', async () => {
    await clearAuthCookies()
    const names = set.mock.calls.map((call) => call[0] as string)
    expect(names).toEqual([
      'sb-proj-auth-token.0',
      'sb-proj-auth-token.1',
      'sb-proj-auth-token-code-verifier',
    ])
    for (const [, value, options] of set.mock.calls) {
      expect(value).toBe('')
      expect(options).toMatchObject({
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      })
    }
  })

  it('the "where next" cookie is HttpOnly, short-lived and scoped to /auth', async () => {
    await rememberNext('/dashboard/account')
    expect(set).toHaveBeenCalledExactlyOnceWith(
      'sn_next',
      '/dashboard/account',
      expect.objectContaining({
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/auth',
        maxAge: 600,
      }),
    )
    expect(nextCookieOptions().path).toBe('/auth')
  })
})
