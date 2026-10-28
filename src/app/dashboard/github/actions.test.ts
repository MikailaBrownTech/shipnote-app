import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const installUrl = vi.fn()
const startState = vi.fn()
const rateLimit = vi.fn()
const disconnectGithub = vi.fn()
const revalidatePath = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})
const notFound = vi.fn(() => {
  throw new Error('not-found')
})

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect, notFound }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/github-app', () => ({ githubIsEnabled, installUrl }))
vi.mock('@/server/github-state', () => ({ startState }))
vi.mock('@/server/github-projects', () => ({ disconnectGithub }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))

const {
  connectGithubAction,
  disconnectGithubFromDashboardAction,
  syncGithubAction,
} = await import('./actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const GITHUB_URL =
  'https://github.com/apps/shipnote-dev/installations/new?state=nonce123'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  githubIsEnabled.mockReturnValue(true)
  rateLimit.mockResolvedValue(true)
  startState.mockResolvedValue('nonce123')
  installUrl.mockReturnValue(GITHUB_URL)
  disconnectGithub.mockResolvedValue(true)
})

describe('connectGithubAction', () => {
  it('from the dashboard: stores no project and sends the person to GitHub', async () => {
    await expect(connectGithubAction(form({}))).rejects.toThrow(
      `redirect:${GITHUB_URL}`,
    )
    expect(startState).toHaveBeenCalledExactlyOnceWith(USER, null)
    expect(installUrl).toHaveBeenCalledWith('nonce123')
  })

  it('from a project page: stores only the project id', async () => {
    await expect(
      connectGithubAction(form({ project: PROJECT })),
    ).rejects.toThrow(`redirect:${GITHUB_URL}`)
    expect(startState).toHaveBeenCalledExactlyOnceWith(USER, PROJECT)
  })

  it.each([
    '/dashboard',
    '/dashboard/projects/x',
    'https://evil.test/',
    '//evil.test/',
    '../../etc',
    'not-a-uuid',
    `${PROJECT}x`,
    "1' or '1'='1",
    '<script>',
    '',
  ])(
    'treats %s as "no project": only a project id is ever stored',
    async (project) => {
      await expect(connectGithubAction(form({ project }))).rejects.toThrow(
        `redirect:${GITHUB_URL}`,
      )
      expect(startState).toHaveBeenCalledExactlyOnceWith(USER, null)
    },
  )

  it('ignores an old-style "next" field: no path can be carried', async () => {
    await expect(
      connectGithubAction(form({ next: 'https://evil.test/' })),
    ).rejects.toThrow(`redirect:${GITHUB_URL}`)
    expect(startState).toHaveBeenCalledWith(USER, null)
    expect(JSON.stringify(startState.mock.calls)).not.toContain('evil')
  })

  it('requires a user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(connectGithubAction(form({}))).rejects.toThrow(
      'redirect:/sign-in',
    )
    expect(startState).not.toHaveBeenCalled()
  })

  it('is a 404 while the feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    await expect(connectGithubAction(form({}))).rejects.toThrow('not-found')
    expect(startState).not.toHaveBeenCalled()
  })

  it('is rate limited per user, and comes back to the dashboard with a message', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(connectGithubAction(form({}))).rejects.toThrow(
      'redirect:/dashboard?github=limited',
    )
    expect(rateLimit).toHaveBeenCalledWith('githubSetup', USER)
    expect(startState).not.toHaveBeenCalled()
  })

  it('rate limited from a project page comes back to that project', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(
      connectGithubAction(form({ project: PROJECT })),
    ).rejects.toThrow(`redirect:/dashboard/projects/${PROJECT}?github=limited`)
    expect(startState).not.toHaveBeenCalled()
  })

  it('a missing GitHub address is a 404, not a broken redirect', async () => {
    installUrl.mockReturnValue(null)
    await expect(connectGithubAction(form({}))).rejects.toThrow('not-found')
  })
})

describe('disconnectGithubFromDashboardAction', () => {
  it('removes the connection for the session user and returns to the dashboard', async () => {
    await expect(
      disconnectGithubFromDashboardAction(form({ installation: '42' })),
    ).rejects.toThrow('redirect:/dashboard?github=disconnected')
    expect(disconnectGithub).toHaveBeenCalledExactlyOnceWith(USER, 42)
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('never takes the user from the form', async () => {
    await expect(
      disconnectGithubFromDashboardAction(
        form({ installation: '42', user_id: 'someone-else' }),
      ),
    ).rejects.toThrow('redirect:')
    expect(JSON.stringify(disconnectGithub.mock.calls)).not.toContain(
      'someone-else',
    )
  })

  it.each(['', 'abc', '-1', '4.2', '9'.repeat(20)])(
    'refuses the installation id %s',
    async (installation) => {
      await expect(
        disconnectGithubFromDashboardAction(form({ installation })),
      ).rejects.toThrow('redirect:/dashboard?github=failed')
      expect(disconnectGithub).not.toHaveBeenCalled()
    },
  )

  it('requires a user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(
      disconnectGithubFromDashboardAction(form({ installation: '42' })),
    ).rejects.toThrow('redirect:/sign-in')
    expect(disconnectGithub).not.toHaveBeenCalled()
  })

  it('is a 404 while the feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    await expect(
      disconnectGithubFromDashboardAction(form({ installation: '42' })),
    ).rejects.toThrow('not-found')
    expect(disconnectGithub).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(
      disconnectGithubFromDashboardAction(form({ installation: '42' })),
    ).rejects.toThrow('redirect:/dashboard?github=limited')
    expect(disconnectGithub).not.toHaveBeenCalled()
  })

  it('reports a failure plainly', async () => {
    disconnectGithub.mockResolvedValue(false)
    await expect(
      disconnectGithubFromDashboardAction(form({ installation: '42' })),
    ).rejects.toThrow('redirect:/dashboard?github=failed')
  })
})

describe('syncGithubAction', () => {
  it('needs a session first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(syncGithubAction()).rejects.toThrow('redirect:/sign-in')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('is a not-found page while GitHub is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    await expect(syncGithubAction()).rejects.toThrow('not-found')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('asks for a fresh render of the GitHub page and nothing else', async () => {
    await syncGithubAction()
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith('/dashboard/github')
  })
})
