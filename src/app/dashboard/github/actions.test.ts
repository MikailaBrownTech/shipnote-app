import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const installUrl = vi.fn()
const startState = vi.fn()
const rateLimit = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})
const notFound = vi.fn(() => {
  throw new Error('not-found')
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect, notFound }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/github-app', () => ({ githubIsEnabled, installUrl }))
vi.mock('@/server/github-state', () => ({ startState }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))

const { connectGithubAction } = await import('./actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '/dashboard/projects/11111111-2222-4333-8444-555555555555'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('connectGithubAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    githubIsEnabled.mockReturnValue(true)
    rateLimit.mockResolvedValue(true)
    startState.mockResolvedValue('nonce123')
    installUrl.mockReturnValue(
      'https://github.com/apps/shipnote-dev/installations/new?state=nonce123',
    )
  })

  it('sets the signed state for this user and sends them to GitHub', async () => {
    await expect(connectGithubAction(form({ next: PROJECT }))).rejects.toThrow(
      'redirect:https://github.com/apps/shipnote-dev/installations/new?state=nonce123',
    )
    expect(startState).toHaveBeenCalledExactlyOnceWith(USER, PROJECT)
    expect(installUrl).toHaveBeenCalledWith('nonce123')
  })

  it('requires a user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(connectGithubAction(form({ next: PROJECT }))).rejects.toThrow(
      'redirect:/sign-in',
    )
    expect(startState).not.toHaveBeenCalled()
  })

  it('is a 404 while the feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    await expect(connectGithubAction(form({ next: PROJECT }))).rejects.toThrow(
      'not-found',
    )
    expect(startState).not.toHaveBeenCalled()
  })

  it('is rate limited per user before anything is set', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(connectGithubAction(form({ next: PROJECT }))).rejects.toThrow(
      `redirect:${PROJECT}?github=limited`,
    )
    expect(rateLimit).toHaveBeenCalledWith('githubSetup', USER)
    expect(startState).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.test/',
    '//evil.test/',
    '/sign-in',
    '/auth/callback',
    '/dashboardx',
    '/\\evil.test',
    '',
  ])('only comes back to a dashboard path, never to %s', async (next) => {
    await expect(connectGithubAction(form({ next }))).rejects.toThrow(
      'redirect:',
    )
    expect(startState).toHaveBeenCalledWith(USER, '/dashboard')
  })

  it('keeps a dashboard path with a query', async () => {
    await expect(
      connectGithubAction(form({ next: `${PROJECT}/repo` })),
    ).rejects.toThrow('redirect:')
    expect(startState).toHaveBeenCalledWith(USER, `${PROJECT}/repo`)
  })
})
