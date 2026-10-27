import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const rateLimit = vi.fn()
const consumeState = vi.fn()
const verifyInstallation = vi.fn()
const saveVerifiedInstallation = vi.fn()

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

const { GET } = await import('./route')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '/dashboard/projects/11111111-2222-4333-8444-555555555555'
const verified = {
  ok: true,
  installation: { installationId: 42, accountLogin: 'octo', accountId: 7 },
}

const call = (query: string) =>
  GET(
    new NextRequest(`https://shipnote.test/dashboard/github/callback${query}`),
  )
const where = (response: Response) => response.headers.get('location')

describe('GET /dashboard/github/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    githubIsEnabled.mockReturnValue(true)
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    rateLimit.mockResolvedValue(true)
    consumeState.mockResolvedValue({ ok: true, next: PROJECT })
    verifyInstallation.mockResolvedValue(verified)
    saveVerifiedInstallation.mockResolvedValue('saved')
  })

  it('is a 404 while the feature is off, and does nothing', async () => {
    githubIsEnabled.mockReturnValue(false)
    const response = await call('?code=abcdefgh12&installation_id=42')
    expect(response.status).toBe(404)
    expect(requireUser).not.toHaveBeenCalled()
    expect(verifyInstallation).not.toHaveBeenCalled()
  })

  it('requires a signed-in user before anything else', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(call('?code=abcdefgh12&installation_id=42')).rejects.toThrow(
      'redirect:/sign-in',
    )
    expect(consumeState).not.toHaveBeenCalled()
    expect(verifyInstallation).not.toHaveBeenCalled()
    expect(saveVerifiedInstallation).not.toHaveBeenCalled()
  })

  it('connects: verifies with GitHub, saves for the SESSION user, and returns to the project', async () => {
    const response = await call('?code=abcdefgh12&installation_id=42')
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
      `https://shipnote.test${PROJECT}?github=connected`,
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('never takes the user from the URL', async () => {
    await call(
      `?code=abcdefgh12&installation_id=42&user_id=someone-else&userId=someone-else`,
    )
    expect(saveVerifiedInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
    )
    expect(JSON.stringify(saveVerifiedInstallation.mock.calls)).not.toContain(
      'someone-else',
    )
  })

  it('works when GitHub sends no installation id', async () => {
    await call('?code=abcdefgh12')
    expect(verifyInstallation).toHaveBeenCalledWith({
      code: 'abcdefgh12',
      claimedInstallationId: null,
    })
  })

  it('passes the returned state to the check, and refuses without the cookie', async () => {
    await call('?code=abcdefgh12&installation_id=42&state=abc')
    expect(consumeState).toHaveBeenCalledWith({
      userId: USER,
      returnedState: 'abc',
    })

    consumeState.mockResolvedValue({ ok: false })
    verifyInstallation.mockClear()
    saveVerifiedInstallation.mockClear()
    const response = await call('?code=abcdefgh12&installation_id=42')
    expect(where(response)).toBe(
      'https://shipnote.test/dashboard?github=expired',
    )
    expect(verifyInstallation).not.toHaveBeenCalled()
    expect(saveVerifiedInstallation).not.toHaveBeenCalled()
  })

  it('a FORGED installation id stores nothing', async () => {
    verifyInstallation.mockResolvedValue({ ok: false, reason: 'invalid' })
    const response = await call('?code=abcdefgh12&installation_id=99')
    expect(where(response)).toBe(
      `https://shipnote.test${PROJECT}?github=invalid`,
    )
    expect(saveVerifiedInstallation).not.toHaveBeenCalled()
  })

  it.each([
    ['org', 'org'],
    ['denied', 'denied'],
    ['unavailable', 'unavailable'],
    ['rate_limited', 'unavailable'],
    ['failed', 'failed'],
  ])('a %s result stores nothing and shows %s', async (reason, flash) => {
    verifyInstallation.mockResolvedValue({ ok: false, reason })
    const response = await call('?code=abcdefgh12&installation_id=42')
    expect(where(response)).toBe(
      `https://shipnote.test${PROJECT}?github=${flash}`,
    )
    expect(saveVerifiedInstallation).not.toHaveBeenCalled()
  })

  it.each([
    ['no code', '?installation_id=42'],
    ['a short code', '?code=abc&installation_id=42'],
    ['a code with odd characters', '?code=abc%20def%26x12&installation_id=42'],
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
    const response = await call(query)
    expect(where(response)).toBe(
      `https://shipnote.test${PROJECT}?github=invalid`,
    )
    expect(verifyInstallation).not.toHaveBeenCalled()
    expect(saveVerifiedInstallation).not.toHaveBeenCalled()
  })

  it('an installation that belongs to another Shipnote account is not changed', async () => {
    saveVerifiedInstallation.mockResolvedValue('taken')
    const response = await call('?code=abcdefgh12&installation_id=42')
    expect(where(response)).toBe(`https://shipnote.test${PROJECT}?github=taken`)
  })

  it('a failed save is reported plainly', async () => {
    saveVerifiedInstallation.mockResolvedValue('failed')
    const response = await call('?code=abcdefgh12&installation_id=42')
    expect(where(response)).toBe(
      `https://shipnote.test${PROJECT}?github=failed`,
    )
  })

  it('is rate limited per user, before any GitHub call', async () => {
    rateLimit.mockResolvedValue(false)
    const response = await call('?code=abcdefgh12&installation_id=42')
    expect(rateLimit).toHaveBeenCalledWith('githubSetup', USER)
    expect(where(response)).toBe(
      'https://shipnote.test/dashboard?github=limited',
    )
    expect(consumeState).not.toHaveBeenCalled()
    expect(verifyInstallation).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.test/',
    '//evil.test/',
    '/\\evil.test',
    'javascript:alert(1)',
    '',
  ])(
    'never redirects off-site, whatever the cookie held (%s)',
    async (next) => {
      consumeState.mockResolvedValue({ ok: true, next })
      const response = await call('?code=abcdefgh12&installation_id=42')
      expect(where(response)).toBe(
        'https://shipnote.test/dashboard?github=connected',
      )
    },
  )

  it('never echoes the URL parameters back', async () => {
    const response = await call(
      '?code=abcdefgh12&installation_id=42&next=https://evil.test&github=<script>',
    )
    const target = where(response) ?? ''
    expect(target).not.toContain('evil')
    expect(target).not.toContain('script')
  })
})
