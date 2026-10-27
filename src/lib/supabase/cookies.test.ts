import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// These tests run the real @supabase/ssr client against a fake cookie store
// and a stubbed network, and check the flags on what it writes.

type Write = {
  name: string
  value: string
  options: Record<string, unknown>
}
const writes: Write[] = []
const jar = new Map<string, string>()

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string, options: Record<string, unknown>) => {
        writes.push({ name, value, options })
        jar.set(name, value)
      },
    }),
}))
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
    NEXT_PUBLIC_SITE_URL: 'https://shipnote.test',
  },
}))

const { createClient } = await import('./server')
const { updateSession } = await import('./proxy')

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

// A decodable token. Big enough that the session must be split into chunks.
function jwt(expiresIn: number) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({
      sub: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      session_id: 'session-1',
      exp,
      pad: 'x'.repeat(5000),
    }),
    'sig',
  ].join('.')
}

const user = {
  id: 'user-1',
  aud: 'authenticated',
  email: 'ada@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      if (url.includes('/token')) {
        return json({
          access_token: jwt(3600),
          refresh_token: 'refresh-2',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        })
      }
      return json(user)
    }),
  )
}

function expectHardened(list: Write[], secure: boolean) {
  expect(list.length).toBeGreaterThan(0)
  for (const { name, options } of list) {
    expect(options, name).toMatchObject({
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    })
  }
}

describe.each([
  ['production', true],
  ['development', false],
])('auth cookies in %s', (mode, secure) => {
  beforeEach(() => {
    writes.length = 0
    jar.clear()
    vi.stubEnv('NODE_ENV', mode)
    stubNetwork()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('PKCE code verifier cookie (sign-in start) carries the flags', async () => {
    const supabase = await createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: 'https://shipnote.test/auth/callback',
        skipBrowserRedirect: true,
      },
    })
    const verifier = writes.filter((w) => w.name.includes('code-verifier'))
    expect(verifier.length).toBeGreaterThan(0)
    expectHardened(verifier, secure)
  })

  it('every chunk of a large session carries the flags', async () => {
    const supabase = await createClient()
    await supabase.auth.setSession({
      access_token: jwt(3600),
      refresh_token: 'refresh-1',
    })
    await vi.waitFor(() => {
      expect(writes.some((w) => /auth-token\.1$/.test(w.name))).toBe(true)
    })
    const session = writes.filter((w) => w.name.includes('auth-token'))
    expect(session.length).toBeGreaterThan(1)
    expectHardened(session, secure)
  })

  it('removing the session (sign out) uses the same flags', async () => {
    const supabase = await createClient()
    await supabase.auth.setSession({
      access_token: jwt(3600),
      refresh_token: 'refresh-1',
    })
    await vi.waitFor(() => {
      expect(jar.size).toBeGreaterThan(1)
    })
    writes.length = 0
    await supabase.auth.signOut({ scope: 'local' })
    const removed = writes.filter((w) => w.value === '')
    expect(removed.length).toBeGreaterThan(0)
    expectHardened(removed, secure)
    for (const { options } of removed) expect(options.maxAge).toBe(0)
  })

  it('the proxy writes a refreshed session with the same flags', async () => {
    const stale = {
      access_token: jwt(-60),
      refresh_token: 'refresh-1',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) - 60,
      user,
    }
    const request = new NextRequest('https://shipnote.test/dashboard', {
      headers: {
        cookie: `sb-proj-auth-token=base64-${Buffer.from(JSON.stringify(stale)).toString('base64url')}`,
      },
    })
    const response = await updateSession(request)
    const set = response.cookies
      .getAll()
      .filter((c) => c.name.startsWith('sb-proj-auth-token'))
    expect(set.length).toBeGreaterThan(1)
    for (const cookie of set) {
      expect(cookie, cookie.name).toMatchObject({
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
      })
    }
    // A refreshed, valid session is let through to the dashboard.
    expect(response.status).toBe(200)
  })
})
