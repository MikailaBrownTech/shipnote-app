import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSession = vi.fn()
const signOut = vi.fn()
const removeUnverifiedAccount = vi.fn()
const set = vi.fn()
const get = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get, set, getAll: () => [] }),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({ auth: { exchangeCodeForSession, signOut } }),
}))
vi.mock('@/server/client-ip', () => ({ getClientIp: () => 'unknown' }))
vi.mock('@/server/remove-account', () => ({ removeUnverifiedAccount }))
vi.mock('@/server/sign-in-alert', () => ({ recordSignInAndAlert: vi.fn() }))

const { GET } = await import('./route')

const request = (query: string) =>
  new NextRequest(`https://shipnote.test/auth/callback${query}`)

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    get.mockReturnValue({ value: '/dashboard/account' })
    signOut.mockResolvedValue({ error: null })
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'u', email: 'a@b.co', identities: [] } },
      error: null,
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('signs in and sends the person to the remembered local path', async () => {
    const response = await GET(request('?code=abc'))
    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('abc')
    expect(response.headers.get('location')).toBe(
      'https://shipnote.test/dashboard/account',
    )
  })

  it('clears the remembered-path cookie with the same flags it was set with', async () => {
    await GET(request('?code=abc'))
    expect(set).toHaveBeenCalledExactlyOnceWith(
      'sn_next',
      '',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/auth',
        maxAge: 0,
      }),
    )
  })

  it('does not follow an off-site next value', async () => {
    const response = await GET(request('?code=abc&next=https://evil.test/'))
    expect(response.headers.get('location')).toBe('https://shipnote.test/dashboard')
  })

  it('an expired or reused code goes back to sign-in', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: new Error('bad'),
    })
    const response = await GET(request('?code=abc'))
    expect(response.headers.get('location')).toBe(
      'https://shipnote.test/sign-in?error=expired',
    )
  })

  it('an unverified GitHub sign-in is refused and its brand-new account removed', async () => {
    const now = new Date().toISOString()
    exchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: 'u',
          created_at: now,
          identities: [
            {
              provider: 'github',
              last_sign_in_at: now,
              identity_data: { email_verified: false },
            },
          ],
        },
      },
      error: null,
    })
    const response = await GET(request('?code=abc'))
    expect(removeUnverifiedAccount).toHaveBeenCalledExactlyOnceWith('u')
    expect(response.headers.get('location')).toBe(
      'https://shipnote.test/sign-in?error=invite',
    )
  })
})
