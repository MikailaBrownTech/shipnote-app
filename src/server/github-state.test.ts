import { beforeEach, describe, expect, it, vi } from 'vitest'

const jar = new Map<string, string>()
const set = vi.fn((name: string, value: string) => {
  if (value) jar.set(name, value)
  else jar.delete(name)
})
const getGithubEnv = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.get(name)
        return value === undefined ? undefined : { value }
      },
      set,
    }),
}))
vi.mock('./env', () => ({ getGithubEnv }))

const {
  consumeState,
  createState,
  GITHUB_STATE_COOKIE,
  GITHUB_STATE_PATH,
  startState,
  STATE_TTL_MS,
  verifyState,
} = await import('./github-state')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const OTHER = '11111111-2222-4333-8444-555555555555'
const PROJECT = '22222222-3333-4444-8555-666666666666'
const SECRET = 'client-secret-value'
const NOW = 1_800_000_000_000

describe('verifyState', () => {
  const fresh = () =>
    createState({
      userId: USER,
      projectId: PROJECT,
      secret: SECRET,
      nowMs: NOW,
    })

  it('accepts the cookie it made, for the same user, and returns where to go next', () => {
    const { cookieValue } = fresh()
    expect(
      verifyState({
        cookieValue,
        userId: USER,
        secret: SECRET,
        nowMs: NOW + 1000,
      }),
    ).toEqual({ ok: true, projectId: PROJECT })
  })

  it('carries no project when the person started from the dashboard', () => {
    const { cookieValue } = createState({
      userId: USER,
      projectId: null,
      secret: SECRET,
      nowMs: NOW,
    })
    expect(
      verifyState({ cookieValue, userId: USER, secret: SECRET, nowMs: NOW }),
    ).toEqual({ ok: true, projectId: null })
  })

  it.each([
    '/dashboard',
    'https://evil.test/',
    '//evil.test',
    '../../x',
    'not-a-uuid',
    PROJECT + 'x',
    '<script>',
  ])('refuses a signed cookie whose project is not an id (%s)', (projectId) => {
    // Even correctly signed, only a project id or nothing is accepted: the
    // cookie can never carry a path or text.
    const { cookieValue } = createState({
      userId: USER,
      projectId,
      secret: SECRET,
      nowMs: NOW,
    })
    expect(
      verifyState({ cookieValue, userId: USER, secret: SECRET, nowMs: NOW }).ok,
    ).toBe(false)
  })

  it('refuses a different signed-in user', () => {
    const { cookieValue } = fresh()
    expect(
      verifyState({ cookieValue, userId: OTHER, secret: SECRET, nowMs: NOW }),
    ).toEqual({
      ok: false,
    })
  })

  it('refuses it after 10 minutes', () => {
    const { cookieValue } = fresh()
    expect(
      verifyState({
        cookieValue,
        userId: USER,
        secret: SECRET,
        nowMs: NOW + STATE_TTL_MS + 1,
      }).ok,
    ).toBe(false)
    expect(
      verifyState({
        cookieValue,
        userId: USER,
        secret: SECRET,
        nowMs: NOW + STATE_TTL_MS,
      }).ok,
    ).toBe(true)
  })

  it('refuses a cookie signed with another secret', () => {
    const { cookieValue } = fresh()
    expect(
      verifyState({
        cookieValue,
        userId: USER,
        secret: 'other-secret',
        nowMs: NOW,
      }).ok,
    ).toBe(false)
  })

  it('refuses a tampered payload or signature', () => {
    const { cookieValue } = fresh()
    const [payload, signature] = cookieValue.split('.') as [string, string]
    const forged = Buffer.from(
      JSON.stringify({
        n: 'x',
        e: NOW + 999_999_999,
        u: USER,
        x: '',
      }),
    ).toString('base64url')
    for (const bad of [
      `${forged}.${signature}`,
      `${payload}.${signature.slice(0, -2)}AA`,
      `${payload}.`,
      `.${signature}`,
      payload,
      `${payload}.${signature}.extra`,
    ]) {
      expect(
        verifyState({
          cookieValue: bad,
          userId: USER,
          secret: SECRET,
          nowMs: NOW,
        }).ok,
      ).toBe(false)
    }
  })

  it.each([undefined, '', 'garbage', '..', 'a.b', 'x'.repeat(5000)])(
    'refuses a missing or malformed cookie (%s)',
    (cookieValue) => {
      expect(
        verifyState({ cookieValue, userId: USER, secret: SECRET, nowMs: NOW })
          .ok,
      ).toBe(false)
    },
  )

  it('checks the state GitHub sends back, when it sends one', () => {
    const { cookieValue, nonce } = fresh()
    const base = { cookieValue, userId: USER, secret: SECRET, nowMs: NOW }
    expect(verifyState({ ...base, returnedState: nonce }).ok).toBe(true)
    expect(verifyState({ ...base, returnedState: 'not-the-nonce' }).ok).toBe(
      false,
    )
    // GitHub's docs say it may not return state at all in this flow.
    expect(verifyState({ ...base, returnedState: null }).ok).toBe(true)
    expect(verifyState({ ...base, returnedState: undefined }).ok).toBe(true)
  })

  it('does not put the secret or the user id in the clear', () => {
    const { cookieValue } = fresh()
    expect(cookieValue).not.toContain(SECRET)
  })
})

describe('the cookie', () => {
  beforeEach(() => {
    jar.clear()
    vi.clearAllMocks()
    getGithubEnv.mockReturnValue({ clientSecret: SECRET })
  })

  it('is set HttpOnly, Lax, scoped to the callback path, and for 10 minutes', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await startState(USER, null)
    vi.unstubAllEnvs()
    expect(set).toHaveBeenCalledExactlyOnceWith(
      GITHUB_STATE_COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: GITHUB_STATE_PATH,
        maxAge: 600,
      }),
    )
  })

  it('is single use: consuming it clears it', async () => {
    const nonce = await startState(USER, PROJECT)
    expect(typeof nonce).toBe('string')
    expect(await consumeState({ userId: USER, returnedState: null })).toEqual({
      ok: true,
      projectId: PROJECT,
    })
    expect(jar.has(GITHUB_STATE_COOKIE)).toBe(false)
    expect(await consumeState({ userId: USER, returnedState: null })).toEqual({
      ok: false,
    })
  })

  it('a callback with no cookie is refused', async () => {
    expect(await consumeState({ userId: USER, returnedState: null })).toEqual({
      ok: false,
    })
  })

  it('is cleared even when the check fails', async () => {
    await startState(USER, null)
    expect(await consumeState({ userId: OTHER, returnedState: null })).toEqual({
      ok: false,
    })
    expect(jar.has(GITHUB_STATE_COOKIE)).toBe(false)
  })

  it('refuses everything while the feature is off', async () => {
    getGithubEnv.mockReturnValue(null)
    await expect(startState(USER, null)).rejects.toThrow('not enabled')
    expect(await consumeState({ userId: USER, returnedState: null })).toEqual({
      ok: false,
    })
  })
})
