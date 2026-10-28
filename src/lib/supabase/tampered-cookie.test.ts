import { NextRequest } from 'next/server'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Tampered, forged, expired and broken session cookies, through the REAL Supabase
// client and the real proxy and getCurrentUser. Only the network is stubbed: the
// project's signing key is served from a stand-in JWKS, and tokens are signed
// here with real ES256 keys, so signature checking is the library's own.

const jar = new Map<string, string>()
const sessionStillActive = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: () => undefined,
    }),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
    NEXT_PUBLIC_SITE_URL: 'https://shipnote.test',
  },
}))
vi.mock('@/server/session-check', () => ({ sessionStillActive }))

const { updateSession } = await import('./proxy')
const { getCurrentUser } = await import('@/lib/auth')

const COOKIE = 'sb-proj-auth-token'
const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const OTHER = '99999999-1b2d-4c3e-8f4a-5b6c7d8e9f01'

// ---- Real signing keys and tokens ----

const subtle = globalThis.crypto.subtle
const text = (value: string) => new TextEncoder().encode(value)
const b64u = (bytes: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(
    typeof bytes === 'string' ? text(bytes) : new Uint8Array(bytes),
  ).toString('base64url')

async function makeKey(kid: string) {
  const pair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await subtle.exportKey('jwk', pair.publicKey)
  return {
    privateKey: pair.privateKey,
    jwk: { ...jwk, kid, alg: 'ES256', use: 'sig' },
  }
}

type Header = Record<string, unknown>
type Claims = Record<string, unknown>

const nowSeconds = () => Math.floor(Date.now() / 1000)

const claims = (over: Claims = {}): Claims => ({
  sub: USER,
  aud: 'authenticated',
  role: 'authenticated',
  session_id: 'session-1',
  email: 'ada@example.com',
  iat: nowSeconds() - 10,
  exp: nowSeconds() + 3600,
  ...over,
})

async function sign(
  privateKey: CryptoKey,
  header: Header,
  payload: Claims,
): Promise<string> {
  const body = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    text(body),
  )
  return `${body}.${b64u(signature)}`
}

// A session cookie value, as @supabase/ssr writes it.
function sessionCookie(accessToken: string, expiresAt = nowSeconds() + 3600) {
  const session = {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-1',
    user: {
      id: USER,
      aud: 'authenticated',
      email: 'ada@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
  return `base64-${b64u(JSON.stringify(session))}`
}

// Swaps the payload of a signed token and keeps its header and signature.
function withPayload(token: string, payload: Claims) {
  const [header, , signature] = token.split('.')
  return `${header}.${b64u(JSON.stringify(payload))}.${signature}`
}

// ---- The stubbed network ----

let good: Awaited<ReturnType<typeof makeKey>>
let evil: Awaited<ReturnType<typeof makeKey>>
let refreshAnswer: 'refused' | 'unreachable'
let knownTokens: Set<string>
let networkDown: boolean

// The library keeps the project's signing keys in a cache shared by every client
// (ten minutes), so keys that changed between tests would make genuine tokens fail
// for the wrong reason. They are made once.
beforeAll(async () => {
  good = await makeKey('k1')
  evil = await makeKey('k1')
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  jar.clear()
  refreshAnswer = 'refused'
  knownTokens = new Set()
  networkDown = false
  sessionStillActive.mockResolvedValue(true)
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const json = (status: number, body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        )
      if (networkDown) return Promise.reject(new TypeError('network down'))
      if (url.endsWith('/.well-known/jwks.json')) {
        return json(200, { keys: [good.jwk] })
      }
      if (url.includes('/auth/v1/user')) {
        const auth = new Headers(init?.headers).get('authorization') ?? ''
        return knownTokens.has(auth.replace(/^Bearer /, ''))
          ? json(200, { id: USER, aud: 'authenticated' })
          : json(401, { message: 'invalid JWT' })
      }
      if (url.includes('/auth/v1/token')) {
        return refreshAnswer === 'unreachable'
          ? Promise.reject(new TypeError('network down'))
          : json(400, {
              error: 'invalid_grant',
              error_description: 'Invalid Refresh Token',
            })
      }
      return json(404, {})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---- Running a request ----

const request = (path: string, cookie: string | null, host?: string) =>
  new NextRequest(`https://shipnote.test${path}`, {
    headers: {
      ...(cookie === null ? {} : { cookie: `${COOKIE}=${cookie}` }),
      ...(host ? { host } : {}),
    },
  })

const goesThrough = (res: Response) =>
  res.status === 200 && !res.headers.get('location')
const redirectsToSignIn = (res: Response) =>
  res.status === 307 &&
  res.headers.get('location') === 'https://shipnote.test/sign-in'

async function dashboard(cookie: string | null) {
  return updateSession(request('/dashboard', cookie))
}

async function signedIn(cookie: string | null) {
  jar.clear()
  if (cookie !== null) jar.set(COOKIE, cookie)
  return getCurrentUser()
}

// The token cases, run through both the proxy and getCurrentUser, so a token that
// gets past one cannot get past the other.
async function genuineCookie() {
  const token = await sign(
    good.privateKey,
    { alg: 'ES256', kid: 'k1', typ: 'JWT' },
    claims(),
  )
  return sessionCookie(token)
}

async function expectRejected(cookie: string | null, why: string) {
  // The control: the same setup accepts a genuine token.
  const control = await genuineCookie()
  expect(goesThrough(await dashboard(control)), `control for ${why}`).toBe(true)
  expect(await signedIn(control), `control for ${why}`).not.toBeNull()
  expect(redirectsToSignIn(await dashboard(cookie)), `proxy: ${why}`).toBe(true)
  expect(await signedIn(cookie), `getCurrentUser: ${why}`).toBeNull()
}

describe('a genuine session', () => {
  it('is let through by the proxy, and identifies the user', async () => {
    const token = await sign(
      good.privateKey,
      { alg: 'ES256', kid: 'k1', typ: 'JWT' },
      claims(),
    )
    const cookie = sessionCookie(token)
    expect(goesThrough(await dashboard(cookie))).toBe(true)
    expect(await signedIn(cookie)).toMatchObject({
      id: USER,
      email: 'ada@example.com',
    })
  })
})

describe('a tampered token is refused', () => {
  const header = { alg: 'ES256', kid: 'k1', typ: 'JWT' }

  it('one signed by someone else, with the right key id', async () => {
    const forged = await sign(evil.privateKey, header, claims())
    await expectRejected(sessionCookie(forged), 'signed with another key')
  })

  it('one whose payload was edited to become another user, with the old signature', async () => {
    const real = await sign(good.privateKey, header, claims())
    await expectRejected(
      sessionCookie(withPayload(real, claims({ sub: OTHER }))),
      'sub changed',
    )
  })

  it('one whose payload was edited to live longer or to change role', async () => {
    const real = await sign(good.privateKey, header, claims())
    await expectRejected(
      sessionCookie(withPayload(real, claims({ exp: nowSeconds() + 10 ** 9 }))),
      'exp extended',
    )
    await expectRejected(
      sessionCookie(withPayload(real, claims({ role: 'service_role' }))),
      'role changed',
    )
  })

  it('one with a signature that is cut short, empty or missing', async () => {
    const real = await sign(good.privateKey, header, claims())
    const [h, p, s] = real.split('.')
    await expectRejected(
      sessionCookie(`${h}.${p}.${s.slice(0, 20)}`),
      'short signature',
    )
    await expectRejected(sessionCookie(`${h}.${p}.`), 'empty signature')
    await expectRejected(sessionCookie(`${h}.${p}`), 'no signature')
  })

  it('one that says it needs no signature (alg none)', async () => {
    const none = `${b64u(JSON.stringify({ alg: 'none', kid: 'k1', typ: 'JWT' }))}.${b64u(JSON.stringify(claims()))}.`
    await expectRejected(sessionCookie(none), 'alg none')
    const noKid = `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64u(JSON.stringify(claims()))}.`
    await expectRejected(sessionCookie(noKid), 'alg none without a key id')
  })

  it('one that claims to be signed with a shared secret (HS256), which the server then refuses', async () => {
    // The algorithm-confusion attack: the library asks the server about it, and
    // the server has never seen this token.
    const forged = `${b64u(JSON.stringify({ alg: 'HS256', kid: 'k1', typ: 'JWT' }))}.${b64u(JSON.stringify(claims()))}.${b64u('anything')}`
    await expectRejected(sessionCookie(forged), 'HS256 forged')
  })

  it('one signed with a key the project does not publish', async () => {
    const other = await sign(
      evil.privateKey,
      { alg: 'ES256', kid: 'unknown', typ: 'JWT' },
      claims(),
    )
    await expectRejected(sessionCookie(other), 'unknown key id')
  })

  it('one that is expired and cannot be refreshed', async () => {
    const old = await sign(
      good.privateKey,
      header,
      claims({ exp: nowSeconds() - 60, iat: nowSeconds() - 3700 }),
    )
    await expectRejected(
      sessionCookie(old, nowSeconds() - 60),
      'expired, refresh refused',
    )
  })

  it('a genuine token with no session id is refused by getCurrentUser even though it verifies', async () => {
    const token = await sign(
      good.privateKey,
      header,
      claims({ session_id: undefined }),
    )
    const cookie = sessionCookie(token)
    // The proxy only refreshes and checks the signature; the page check is stricter.
    expect(goesThrough(await dashboard(cookie))).toBe(true)
    expect(await signedIn(cookie)).toBeNull()
    expect(sessionStillActive).not.toHaveBeenCalled()
  })

  it('a genuine token whose session was revoked is refused by getCurrentUser', async () => {
    sessionStillActive.mockResolvedValue(false)
    const token = await sign(good.privateKey, header, claims())
    const cookie = sessionCookie(token)
    expect(await signedIn(cookie)).toBeNull()
    expect(sessionStillActive).toHaveBeenCalledWith('session-1', USER)
  })
})

describe('a broken cookie is refused, never an error', () => {
  it.each([
    ['no cookie at all', null],
    ['an empty cookie', ''],
    ['text that is not encoded', 'not-a-session'],
    ['an encoded value that is not JSON', `base64-${b64u('{broken')}`],
    [
      'JSON of the wrong shape',
      `base64-${b64u(JSON.stringify({ hello: 'world' }))}`,
    ],
    ['an array', `base64-${b64u(JSON.stringify([1, 2, 3]))}`],
    ['a session whose token is not a token', sessionCookie('not.a.jwt')],
    ['a session whose token is just a word', sessionCookie('token')],
    ['a very long value', `base64-${'A'.repeat(20_000)}`],
    ['markup', '<script>alert(1)</script>'],
  ])('%s', async (_name, cookie) => {
    await expectRejected(cookie, _name)
  })

  it('a cookie that is a valid session of a different shape of token (a plain string of dots)', async () => {
    await expectRejected(sessionCookie('a.b.c'), 'dots')
    await expectRejected(sessionCookie('..'), 'empty dots')
  })
})

describe('the proxy itself', () => {
  const garbage = 'not-a-session'

  it('every page under /dashboard needs a valid session', async () => {
    for (const path of [
      '/dashboard',
      '/dashboard/projects',
      '/dashboard/projects/abc/edit',
      '/dashboard/settings/voice',
    ]) {
      const res = await updateSession(request(path, null))
      expect(redirectsToSignIn(res), path).toBe(true)
    }
  })

  it('public pages work with no cookie and with a broken one, without an error', async () => {
    for (const path of ['/', '/sign-in', '/auth/callback']) {
      for (const cookie of [null, garbage, sessionCookie('a.b.c')]) {
        expect(
          goesThrough(await updateSession(request(path, cookie))),
          path,
        ).toBe(true)
      }
    }
  })

  it('goes to the configured site, never to a host the request named', async () => {
    const res = await updateSession(request('/dashboard', null, 'evil.example'))
    expect(res.headers.get('location')).toBe('https://shipnote.test/sign-in')
  })

  it('a tampered token never makes it past on a public page into the dashboard', async () => {
    const forged = await sign(
      evil.privateKey,
      { alg: 'ES256', kid: 'k1', typ: 'JWT' },
      claims(),
    )
    expect(
      redirectsToSignIn(
        await updateSession(request('/dashboard', sessionCookie(forged))),
      ),
    ).toBe(true)
  })

  it('fails closed when Supabase cannot be reached: a token whose key cannot be fetched is not trusted', async () => {
    networkDown = true
    // A key id the library has not cached. It cannot be fetched, so the token
    // cannot be shown genuine, and it is refused rather than let through.
    const token = await sign(
      evil.privateKey,
      { alg: 'ES256', kid: 'never-cached', typ: 'JWT' },
      claims(),
    )
    expect(redirectsToSignIn(await dashboard(sessionCookie(token)))).toBe(true)
    expect(await signedIn(sessionCookie(token))).toBeNull()
  })

  it('a genuine token still verifies from the cached signing key while Supabase is unreachable', async () => {
    const cookie = await genuineCookie()
    // Warm the cache while the network is up, then take it away.
    expect(goesThrough(await dashboard(cookie))).toBe(true)
    networkDown = true
    expect(goesThrough(await dashboard(cookie))).toBe(true)
  })

  it('does not log a token, a cookie or a key', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const forged = await sign(
      evil.privateKey,
      { alg: 'ES256', kid: 'k1', typ: 'JWT' },
      claims(),
    )
    await dashboard(sessionCookie(forged))
    await signedIn(sessionCookie(forged))
    const logged = JSON.stringify(spies.map((s) => s.mock.calls))
    expect(logged).not.toContain(forged)
    expect(logged).not.toContain('refresh-1')
  })
})
