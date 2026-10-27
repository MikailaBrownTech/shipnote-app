import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const rateLimit = vi.fn()
const consumeState = vi.fn()
const verifyInstallation = vi.fn()
const saveVerifiedInstallation = vi.fn()
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
vi.mock('@/server/github-app', () => ({
  githubIsEnabled,
  saveVerifiedInstallation,
}))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/github-state', () => ({ consumeState }))
vi.mock('@/server/github-connect', () => ({ verifyInstallation }))
vi.mock('@/server/projects', () => ({ getProject }))

const { GET } = await import('./route')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const PROJECT_PATH = `/dashboard/projects/${PROJECT}`
const verified = {
  ok: true,
  installation: { installationId: 42, accountLogin: 'octo', accountId: 7 },
}

const call = (query: string) =>
  GET(
    new NextRequest(`https://shipnote.test/dashboard/github/callback${query}`),
  )
const where = (response: Response) => response.headers.get('location')
const GOOD = '?code=abcdefgh12&installation_id=42'

describe('GET /dashboard/github/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    githubIsEnabled.mockReturnValue(true)
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    rateLimit.mockResolvedValue(true)
    // Started from the dashboard unless a test says otherwise.
    consumeState.mockResolvedValue({ ok: true, projectId: null })
    verifyInstallation.mockResolvedValue(verified)
    saveVerifiedInstallation.mockResolvedValue('saved')
    getProject.mockResolvedValue({ ok: true, value: { id: PROJECT } })
  })

  it('is a 404 while the feature is off, and does nothing', async () => {
    githubIsEnabled.mockReturnValue(false)
    const response = await call(GOOD)
    expect(response.status).toBe(404)
    expect(requireUser).not.toHaveBeenCalled()
    expect(verifyInstallation).not.toHaveBeenCalled()
  })

  it('requires a signed-in user before anything else', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(call(GOOD)).rejects.toThrow('redirect:/sign-in')
    expect(consumeState).not.toHaveBeenCalled()
    expect(verifyInstallation).not.toHaveBeenCalled()
    expect(saveVerifiedInstallation).not.toHaveBeenCalled()
  })

  describe('success', () => {
    it('from the dashboard: verifies, saves for the SESSION user, and returns to /dashboard', async () => {
      const response = await call(GOOD)
      expect(verifyInstallation).toHaveBeenCalledExactlyOnceWith({
        code: 'abcdefgh12',
        claimedInstallationId: 42,
      })
      expect(saveVerifiedInstallation).toHaveBeenCalledExactlyOnceWith({
        userId: USER,
        installationId: 42,
        accountLogin: 'octo',
        accountId: 7,
      })
      expect(where(response)).toBe(
        'https://shipnote.test/dashboard?github=connected',
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(getProject).not.toHaveBeenCalled()
    })

    it('from a project page: returns to that project, after checking it is the user’s', async () => {
      consumeState.mockResolvedValue({ ok: true, projectId: PROJECT })
      const response = await call(GOOD)
      expect(getProject).toHaveBeenCalledExactlyOnceWith(USER, PROJECT)
      expect(where(response)).toBe(
        `https://shipnote.test${PROJECT_PATH}?github=connected`,
      )
    })

    it.each([
      ['not the user’s (or gone)', { ok: false, reason: 'not_found' }],
      ['unreadable right now', { ok: false, reason: 'failed' }],
    ])(
      'a project that is %s sends them to /dashboard instead',
      async (_label, result) => {
        consumeState.mockResolvedValue({ ok: true, projectId: PROJECT })
        getProject.mockResolvedValue(result)
        const response = await call(GOOD)
        expect(where(response)).toBe(
          'https://shipnote.test/dashboard?github=connected',
        )
        // Still connected: only where they land changes.
        expect(saveVerifiedInstallation).toHaveBeenCalledOnce()
      },
    )

    it('builds the project path from the id the database returned, never from the cookie', async () => {
      consumeState.mockResolvedValue({ ok: true, projectId: '../../evil' })
      getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?github=connected',
      )

      getProject.mockResolvedValue({ ok: true, value: { id: PROJECT } })
      const response = await call(GOOD)
      expect(where(response)).toBe(
        `https://shipnote.test${PROJECT_PATH}?github=connected`,
      )
    })

    it('works when GitHub sends no installation id', async () => {
      await call('?code=abcdefgh12')
      expect(verifyInstallation).toHaveBeenCalledWith({
        code: 'abcdefgh12',
        claimedInstallationId: null,
      })
    })
  })

  describe('failure always lands on /dashboard with a plain message', () => {
    beforeEach(() => {
      // Even when the person started from a project.
      consumeState.mockResolvedValue({ ok: true, projectId: PROJECT })
    })

    it.each([
      ['invalid', 'invalid'],
      ['org', 'org'],
      ['denied', 'denied'],
      ['unavailable', 'unavailable'],
      ['rate_limited', 'unavailable'],
      ['failed', 'failed'],
    ])('a %s result stores nothing and shows %s', async (reason, flash) => {
      verifyInstallation.mockResolvedValue({ ok: false, reason })
      const response = await call(GOOD)
      expect(where(response)).toBe(
        `https://shipnote.test/dashboard?github=${flash}`,
      )
      expect(saveVerifiedInstallation).not.toHaveBeenCalled()
      expect(getProject).not.toHaveBeenCalled()
    })

    it('a FORGED installation id stores nothing', async () => {
      verifyInstallation.mockResolvedValue({ ok: false, reason: 'invalid' })
      const response = await call('?code=abcdefgh12&installation_id=99')
      expect(where(response)).toBe(
        'https://shipnote.test/dashboard?github=invalid',
      )
      expect(saveVerifiedInstallation).not.toHaveBeenCalled()
    })

    it('an installation that belongs to another Shipnote account is not changed', async () => {
      saveVerifiedInstallation.mockResolvedValue('taken')
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?github=taken',
      )
    })

    it('a failed save is reported plainly', async () => {
      saveVerifiedInstallation.mockResolvedValue('failed')
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?github=failed',
      )
    })

    it.each([
      ['no code', '?installation_id=42'],
      ['a short code', '?code=abc&installation_id=42'],
      [
        'a code with odd characters',
        '?code=abc%20def%26x12&installation_id=42',
      ],
      ['a very long code', `?code=${'a'.repeat(500)}&installation_id=42`],
      ['a non-numeric installation id', '?code=abcdefgh12&installation_id=4x2'],
      ['a negative installation id', '?code=abcdefgh12&installation_id=-1'],
      [
        'a huge installation id',
        '?code=abcdefgh12&installation_id=99999999999999999999',
      ],
      [
        'an installation id that is code',
        "?code=abcdefgh12&installation_id=1'or'1",
      ],
    ])('%s is invalid and never reaches GitHub', async (_label, query) => {
      expect(where(await call(query))).toBe(
        'https://shipnote.test/dashboard?github=invalid',
      )
      expect(verifyInstallation).not.toHaveBeenCalled()
      expect(saveVerifiedInstallation).not.toHaveBeenCalled()
    })

    it('a missing or bad state cookie is "expired", and nothing is verified', async () => {
      consumeState.mockResolvedValue({ ok: false })
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?github=expired',
      )
      expect(verifyInstallation).not.toHaveBeenCalled()
      expect(saveVerifiedInstallation).not.toHaveBeenCalled()
    })

    it('is rate limited per user, before any GitHub call', async () => {
      rateLimit.mockResolvedValue(false)
      expect(where(await call(GOOD))).toBe(
        'https://shipnote.test/dashboard?github=limited',
      )
      expect(rateLimit).toHaveBeenCalledWith('githubSetup', USER)
      expect(consumeState).not.toHaveBeenCalled()
      expect(verifyInstallation).not.toHaveBeenCalled()
    })
  })

  it('passes the returned state to the check', async () => {
    await call(`${GOOD}&state=abc`)
    expect(consumeState).toHaveBeenCalledWith({
      userId: USER,
      returnedState: 'abc',
    })
  })

  it('never takes the user from the URL', async () => {
    await call(`${GOOD}&user_id=someone-else&userId=someone-else`)
    expect(saveVerifiedInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
    )
    expect(JSON.stringify(saveVerifiedInstallation.mock.calls)).not.toContain(
      'someone-else',
    )
  })

  it('never redirects off-site or echoes URL parameters, whatever they hold', async () => {
    const response = await call(
      `${GOOD}&next=https://evil.test&redirect=//evil.test&github=<script>&message=hello`,
    )
    const target = where(response) ?? ''
    expect(target.startsWith('https://shipnote.test/')).toBe(true)
    expect(target).not.toContain('evil')
    expect(target).not.toContain('script')
    expect(target).not.toContain('hello')
  })

  it('the message is only ever a code from the fixed list', async () => {
    const seen = new Set<string>()
    for (const reason of [
      'invalid',
      'org',
      'denied',
      'unavailable',
      'failed',
    ]) {
      verifyInstallation.mockResolvedValue({ ok: false, reason })
      seen.add(
        new URL(where(await call(GOOD)) ?? '').searchParams.get('github') ?? '',
      )
    }
    expect([...seen].sort()).toEqual(
      ['denied', 'failed', 'invalid', 'org', 'unavailable'].sort(),
    )
  })
})
