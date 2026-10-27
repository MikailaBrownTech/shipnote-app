import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const schedulingIsEnabled = vi.fn()
const rateLimit = vi.fn()
const consumeState = vi.fn()
const completeConnect = vi.fn()
const getProject = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/buffer-state', () => ({ consumeState }))
vi.mock('@/server/projects', () => ({ getProject }))
vi.mock('@/server/scheduling', () => ({ completeConnect, schedulingIsEnabled }))

const { GET } = await import('./route')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const VERIFIER = 'v'.repeat(43)

const call = (query: string) =>
  GET(
    new NextRequest(`https://shipnote.test/dashboard/buffer/callback${query}`),
  )
const where = (response: Response) => response.headers.get('location')
const GOOD = '?code=abcdefgh12&state=the-state'

beforeEach(() => {
  vi.clearAllMocks()
  schedulingIsEnabled.mockReturnValue(true)
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  rateLimit.mockResolvedValue(true)
  consumeState.mockResolvedValue({
    ok: true,
    verifier: VERIFIER,
    returnTo: null,
  })
  completeConnect.mockResolvedValue('connected')
  getProject.mockResolvedValue({ ok: true, value: { id: PROJECT } })
})

describe('GET /dashboard/buffer/callback', () => {
  it('is a 404 while scheduling is off, and does nothing', async () => {
    schedulingIsEnabled.mockReturnValue(false)
    const response = await call(GOOD)
    expect(response.status).toBe(404)
    expect(requireUser).not.toHaveBeenCalled()
    expect(consumeState).not.toHaveBeenCalled()
    expect(completeConnect).not.toHaveBeenCalled()
  })

  it('requires a signed-in user before anything else', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(call(GOOD)).rejects.toThrow('redirect:/sign-in')
    expect(consumeState).not.toHaveBeenCalled()
    expect(completeConnect).not.toHaveBeenCalled()
  })

  it('is rate limited before the cookie is read', async () => {
    rateLimit.mockResolvedValue(false)
    expect(where(await call(GOOD))).toBe(
      'https://shipnote.test/dashboard?buffer=limited',
    )
    expect(rateLimit).toHaveBeenCalledWith('bufferConnect', USER)
    expect(completeConnect).not.toHaveBeenCalled()
  })

  describe('success', () => {
    it('exchanges the code for the SESSION user with the verifier from the cookie, and returns to /dashboard', async () => {
      const response = await call(GOOD)
      expect(completeConnect).toHaveBeenCalledExactlyOnceWith({
        userId: USER,
        code: 'abcdefgh12',
        verifier: VERIFIER,
      })
      expect(where(response)).toBe(
        'https://shipnote.test/dashboard?buffer=connected',
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    })

    it('hands the state Buffer returned to the cookie check', async () => {
      await call(GOOD)
      expect(consumeState).toHaveBeenCalledExactlyOnceWith({
        userId: USER,
        returnedState: 'the-state',
      })
    })

    it('goes back to the project the person started from when it is still theirs', async () => {
      consumeState.mockResolvedValue({
        ok: true,
        verifier: VERIFIER,
        returnTo: { projectId: PROJECT, draftId: null },
      })
      expect(where(await call(GOOD))).toBe(
        `https://shipnote.test/dashboard/projects/${PROJECT}?tab=drafts&buffer=connected`,
      )
      expect(getProject).toHaveBeenCalledWith(USER, PROJECT)
    })

    it('falls back to /dashboard when the project is no longer theirs', async () => {
      consumeState.mockResolvedValue({
        ok: true,
        verifier: VERIFIER,
        returnTo: { projectId: PROJECT, draftId: null },
      })
      getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?buffer=connected',
      )
    })
  })

  describe('failures store nothing', () => {
    it.each([
      [
        'no cookie, a bad cookie, a wrong state, an expired one, or a replay',
        () => consumeState.mockResolvedValue({ ok: false }),
      ],
    ])('%s: expired, and no exchange', async (_label, setup) => {
      setup()
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?buffer=expired',
      )
      expect(completeConnect).not.toHaveBeenCalled()
    })

    it('a state forged for another user fails because the cookie is checked for the session user', async () => {
      consumeState.mockImplementation(({ userId }: { userId: string }) =>
        Promise.resolve(
          userId === USER
            ? { ok: false }
            : { ok: true, verifier: VERIFIER, returnTo: null },
        ),
      )
      expect(where(await call(GOOD))).toContain('buffer=expired')
      expect(completeConnect).not.toHaveBeenCalled()
    })

    it('Buffer saying no (error=access_denied) is denied, and the cookie is still spent', async () => {
      expect(where(await call('?error=access_denied&state=the-state'))).toBe(
        'https://shipnote.test/dashboard?buffer=denied',
      )
      expect(consumeState).toHaveBeenCalledOnce()
      expect(completeConnect).not.toHaveBeenCalled()
    })

    it.each([
      '',
      '?state=s',
      '?code=&state=s',
      '?code=short&state=s',
      '?code=has space here&state=s',
      `?code=${'a'.repeat(3000)}&state=s`,
    ])('a missing or malformed code (%s) fails', async (query) => {
      expect(where(await call(query))).toContain('buffer=')
      expect(completeConnect).not.toHaveBeenCalled()
    })

    it.each([
      ['denied', 'denied'],
      ['no_organization', 'no_organization'],
      ['rate_limited', 'rate_limited'],
      ['unavailable', 'unavailable'],
      ['failed', 'failed'],
    ])('a %s result shows %s on the dashboard', async (result, flash) => {
      completeConnect.mockResolvedValue(result)
      expect(where(await call(GOOD))).toBe(
        `https://shipnote.test/dashboard?buffer=${flash}`,
      )
    })

    it('a failure never goes back to the project, even if one was started from', async () => {
      consumeState.mockResolvedValue({
        ok: true,
        verifier: VERIFIER,
        returnTo: { projectId: PROJECT, draftId: null },
      })
      completeConnect.mockResolvedValue('unavailable')
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?buffer=unavailable',
      )
    })
  })

  it('never puts the code, the state, the verifier or a user id in a redirect', async () => {
    for (const result of ['connected', 'denied', 'failed']) {
      completeConnect.mockResolvedValue(result)
      const location = where(await call(GOOD)) ?? ''
      for (const secret of ['abcdefgh12', 'the-state', VERIFIER, USER]) {
        expect(location).not.toContain(secret)
      }
    }
  })

  it('redirects only to the configured site', async () => {
    const response = await GET(
      new NextRequest(
        'https://evil.test/dashboard/buffer/callback?code=abcdefgh12&state=s',
        {
          headers: { host: 'evil.test', 'x-forwarded-host': 'evil.test' },
        },
      ),
    )
    expect(where(response)?.startsWith('https://shipnote.test/')).toBe(true)
  })
})
