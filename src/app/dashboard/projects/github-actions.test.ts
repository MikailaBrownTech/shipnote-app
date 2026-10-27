import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const rateLimit = vi.fn()
const linkRepo = vi.fn()
const unlinkRepo = vi.fn()
const disconnectGithub = vi.fn()
const checkPostCommits = vi.fn()
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
vi.mock('@/server/github-app', () => ({ githubIsEnabled }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/github-projects', () => ({
  linkRepo,
  unlinkRepo,
  disconnectGithub,
  checkPostCommits,
}))

const {
  checkCommitsAction,
  disconnectGithubAction,
  linkRepoAction,
  unlinkRepoAction,
} = await import('./github-actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const PATH = `/dashboard/projects/${ID}`

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
  linkRepo.mockResolvedValue('linked')
  unlinkRepo.mockResolvedValue('unlinked')
  disconnectGithub.mockResolvedValue(true)
  checkPostCommits.mockResolvedValue({
    status: 'ok',
    repo: 'octo/hello',
    commits: [],
  })
})

describe.each([
  ['link', () => linkRepoAction(ID, form({ choice: '42|octo/hello' }))],
  ['unlink', () => unlinkRepoAction(ID)],
  [
    'disconnect',
    () => disconnectGithubAction(ID, form({ installation: '42' })),
  ],
  ['check commits', () => checkCommitsAction(ID)],
])('%s: the common rules', (_name, run) => {
  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(run()).rejects.toThrow('redirect:/sign-in')
    expect(linkRepo).not.toHaveBeenCalled()
    expect(unlinkRepo).not.toHaveBeenCalled()
    expect(disconnectGithub).not.toHaveBeenCalled()
    expect(checkPostCommits).not.toHaveBeenCalled()
  })

  it('is a 404 while the feature is off, and does nothing', async () => {
    githubIsEnabled.mockReturnValue(false)
    await expect(run()).rejects.toThrow('not-found')
    expect(linkRepo).not.toHaveBeenCalled()
    expect(unlinkRepo).not.toHaveBeenCalled()
    expect(disconnectGithub).not.toHaveBeenCalled()
    expect(checkPostCommits).not.toHaveBeenCalled()
  })
})

describe('a malformed project id is a 404 and reaches nothing', () => {
  it.each(['not-a-uuid', '1', "1' or '1'='1", '../../x'])('%s', async (bad) => {
    await expect(
      linkRepoAction(bad, form({ choice: '42|octo/hello' })),
    ).rejects.toThrow('not-found')
    await expect(unlinkRepoAction(bad)).rejects.toThrow('not-found')
    await expect(
      disconnectGithubAction(bad, form({ installation: '42' })),
    ).rejects.toThrow('not-found')
    await expect(checkCommitsAction(bad)).rejects.toThrow('not-found')
    expect(linkRepo).not.toHaveBeenCalled()
    expect(checkPostCommits).not.toHaveBeenCalled()
  })
})

describe('linkRepoAction', () => {
  it('links the chosen repository for the session user and returns to the project', async () => {
    await expect(
      linkRepoAction(ID, form({ choice: '42|octo/hello' })),
    ).rejects.toThrow(`redirect:${PATH}?github=linked`)
    expect(linkRepo).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      projectId: ID,
      installationId: 42,
      repoFullName: 'octo/hello',
    })
    expect(rateLimit).toHaveBeenCalledWith('githubLink', USER)
    expect(revalidatePath).toHaveBeenCalledWith(PATH)
  })

  it.each([
    '',
    'noseparator',
    '|octo/hello',
    'x|octo/hello',
    '42x|octo/hello',
    '-1|octo/hello',
    `${'9'.repeat(20)}|octo/hello`,
  ])(
    'a malformed choice (%s) is refused before anything else',
    async (choice) => {
      await expect(linkRepoAction(ID, form({ choice }))).rejects.toThrow(
        `redirect:${PATH}?github=repo`,
      )
      expect(linkRepo).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['not_in_list', 'repo'],
    ['no_installation', 'repo'],
    ['rate_limited', 'unavailable'],
    ['unavailable', 'unavailable'],
    ['failed', 'failed'],
  ])('a %s result shows %s and nothing else changes', async (result, flash) => {
    linkRepo.mockResolvedValue(result)
    await expect(
      linkRepoAction(ID, form({ choice: '42|octo/hello' })),
    ).rejects.toThrow(`redirect:${PATH}?github=${flash}`)
  })

  it('a project that is not the user’s gives the not-found page', async () => {
    linkRepo.mockResolvedValue('not_found')
    await expect(
      linkRepoAction(ID, form({ choice: '42|octo/hello' })),
    ).rejects.toThrow('not-found')
  })

  it('is rate limited before any lookup', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(
      linkRepoAction(ID, form({ choice: '42|octo/hello' })),
    ).rejects.toThrow(`redirect:${PATH}?github=limited`)
    expect(linkRepo).not.toHaveBeenCalled()
  })

  it('never takes the user from the form', async () => {
    await expect(
      linkRepoAction(
        ID,
        form({
          choice: '42|octo/hello',
          user_id: 'someone-else',
          userId: 'someone-else',
        }),
      ),
    ).rejects.toThrow('redirect:')
    expect(JSON.stringify(linkRepo.mock.calls)).not.toContain('someone-else')
  })
})

describe('unlinkRepoAction', () => {
  it('unlinks and returns to the project', async () => {
    await expect(unlinkRepoAction(ID)).rejects.toThrow(
      `redirect:${PATH}?github=unlinked`,
    )
    expect(unlinkRepo).toHaveBeenCalledExactlyOnceWith(USER, ID)
  })

  it('a foreign project is a 404', async () => {
    unlinkRepo.mockResolvedValue('not_found')
    await expect(unlinkRepoAction(ID)).rejects.toThrow('not-found')
  })

  it('reports a failure plainly', async () => {
    unlinkRepo.mockResolvedValue('failed')
    await expect(unlinkRepoAction(ID)).rejects.toThrow(
      `redirect:${PATH}?github=failed`,
    )
  })
})

describe('disconnectGithubAction', () => {
  it('removes the connection for the session user only', async () => {
    await expect(
      disconnectGithubAction(ID, form({ installation: '42' })),
    ).rejects.toThrow(`redirect:${PATH}?github=disconnected`)
    expect(disconnectGithub).toHaveBeenCalledExactlyOnceWith(USER, 42)
  })

  it.each(['', 'abc', '-1', '4.2', '9'.repeat(20)])(
    'refuses the installation id %s',
    async (installation) => {
      await expect(
        disconnectGithubAction(ID, form({ installation })),
      ).rejects.toThrow(`redirect:${PATH}?github=failed`)
      expect(disconnectGithub).not.toHaveBeenCalled()
    },
  )

  it('is rate limited', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(
      disconnectGithubAction(ID, form({ installation: '42' })),
    ).rejects.toThrow(`redirect:${PATH}?github=limited`)
    expect(disconnectGithub).not.toHaveBeenCalled()
  })

  it('reports a failure plainly', async () => {
    disconnectGithub.mockResolvedValue(false)
    await expect(
      disconnectGithubAction(ID, form({ installation: '42' })),
    ).rejects.toThrow(`redirect:${PATH}?github=failed`)
  })
})

describe('checkCommitsAction', () => {
  it('returns what the check found, for the session user and this project', async () => {
    checkPostCommits.mockResolvedValue({
      status: 'ok',
      repo: 'octo/hello',
      commits: [
        {
          sha: 'abc1234',
          title: 't',
          date: null,
          url: 'https://github.com/octo/hello/commit/abc1234',
        },
      ],
    })
    const result = await checkCommitsAction(ID)
    expect(result).toMatchObject({ status: 'ok' })
    expect(checkPostCommits).toHaveBeenCalledExactlyOnceWith(USER, ID)
  })

  it('is rate limited and does not call GitHub', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await checkCommitsAction(ID)).toEqual({ status: 'limited' })
    expect(rateLimit).toHaveBeenCalledWith('githubCommits', USER)
    expect(checkPostCommits).not.toHaveBeenCalled()
  })

  it('a project that is not the user’s is a 404', async () => {
    checkPostCommits.mockResolvedValue({ status: 'not_found' })
    await expect(checkCommitsAction(ID)).rejects.toThrow('not-found')
  })

  it.each([
    'reconnect',
    'repo_gone',
    'rate_limited',
    'unavailable',
    'failed',
    'not_linked',
  ])('passes a %s outcome through', async (status) => {
    checkPostCommits.mockResolvedValue({ status })
    expect(await checkCommitsAction(ID)).toEqual({ status })
  })

  it('refreshes the page when the installation was forgotten (to show Reconnect)', async () => {
    checkPostCommits.mockResolvedValue({ status: 'reconnect' })
    await checkCommitsAction(ID)
    expect(revalidatePath).toHaveBeenCalledWith(PATH)
  })
})
