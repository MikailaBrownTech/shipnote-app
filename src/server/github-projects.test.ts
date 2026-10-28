import { beforeEach, describe, expect, it, vi } from 'vitest'

class GithubError extends Error {
  kind: string
  constructor(kind: string) {
    super(`GitHub request failed: ${kind}`)
    this.kind = kind
  }
}

const createInstallationToken = vi.fn()
const listInstallationRepos = vi.fn()
const listRecentCommits = vi.fn()
const getProject = vi.fn()
const listProjects = vi.fn()
const linkProjectRepo = vi.fn()
const unlinkProjectRepo = vi.fn()
const removeGithubInstallation = vi.fn()

let installationRows: { data: unknown; error: unknown } = {
  data: [],
  error: null,
}
const chain: object = new Proxy(
  {},
  {
    get(_t, property: string) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) =>
          resolve(installationRows)
      }
      return () => chain
    },
  },
)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ from: () => chain }),
}))
vi.mock('./github', () => ({
  createInstallationToken,
  listInstallationRepos,
  listRecentCommits,
  GithubError,
}))
vi.mock('./projects', () => ({ getProject, listProjects }))
vi.mock('./supabase-admin', () => ({
  linkProjectRepo,
  unlinkProjectRepo,
  removeGithubInstallation,
}))

const { checkPostCommits, linkRepo, listRepoChoices, unlinkRepo } =
  await import('./github-projects')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'ghs_SECRET_INSTALLATION_TOKEN'
const NOW = Date.parse('2026-10-27T12:00:00Z')

const own = (id = 42, login = 'octo') => ({
  installation_id: id,
  account_login: login,
})
const linked = (over: Record<string, unknown> = {}) => ({
  ok: true,
  value: {
    id: PROJECT,
    repoFullName: 'octo/hello',
    installationId: 42,
    ...over,
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  installationRows = { data: [own()], error: null }
  createInstallationToken.mockResolvedValue(TOKEN)
  listInstallationRepos.mockResolvedValue(['octo/hello', 'octo/other'])
  listRecentCommits.mockResolvedValue([])
  getProject.mockResolvedValue(linked())
  listProjects.mockResolvedValue({ ok: true, value: [] })
  linkProjectRepo.mockResolvedValue(true)
  unlinkProjectRepo.mockResolvedValue(true)
  removeGithubInstallation.mockResolvedValue(true)
})

describe('listRepoChoices', () => {
  it('lists repositories from GitHub for each of the user’s installations', async () => {
    const choices = await listRepoChoices(USER)
    expect(choices).toEqual({
      status: 'ok',
      groups: [
        {
          installationId: 42,
          accountLogin: 'octo',
          repos: ['octo/hello', 'octo/other'],
        },
      ],
    })
    expect(createInstallationToken).toHaveBeenCalledWith(42)
  })

  it('says "none" when the user has no installation', async () => {
    installationRows = { data: [], error: null }
    expect(await listRepoChoices(USER)).toEqual({ status: 'none' })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('removes an installation GitHub no longer has, and says "none" if that was all', async () => {
    createInstallationToken.mockRejectedValue(new GithubError('not_installed'))
    expect(await listRepoChoices(USER)).toEqual({ status: 'none' })
    expect(removeGithubInstallation).toHaveBeenCalledExactlyOnceWith(USER, 42)
  })

  it.each([
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['denied', 'failed'],
  ])('GitHub %s becomes %s', async (kind, expected) => {
    listInstallationRepos.mockRejectedValue(new GithubError(kind))
    expect(await listRepoChoices(USER)).toEqual({
      status: 'error',
      kind: expected,
    })
    expect(removeGithubInstallation).not.toHaveBeenCalled()
  })

  it('a database error is a plain failure', async () => {
    installationRows = { data: null, error: { code: '42501' } }
    expect(await listRepoChoices(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
  })

  it('looks at no more than 5 installations', async () => {
    installationRows = {
      data: Array.from({ length: 9 }, (_, i) => own(i + 1, `u${String(i)}`)),
      error: null,
    }
    await listRepoChoices(USER)
    expect(createInstallationToken).toHaveBeenCalledTimes(5)
  })
})

describe('linkRepo', () => {
  const input = {
    userId: USER,
    projectId: PROJECT,
    installationId: 42,
    repoFullName: 'octo/hello',
  }

  it('links a repository that is on the installation’s list', async () => {
    expect(await linkRepo(input)).toBe('linked')
    expect(linkProjectRepo).toHaveBeenCalledExactlyOnceWith(input)
  })

  it('REJECTS a repository that is not on the list, and saves nothing', async () => {
    expect(await linkRepo({ ...input, repoFullName: 'octo/not-listed' })).toBe(
      'not_in_list',
    )
    expect(linkProjectRepo).not.toHaveBeenCalled()
  })

  it('does not accept another user’s repository by guessing its name', async () => {
    expect(
      await linkRepo({ ...input, repoFullName: 'someone-else/private' }),
    ).toBe('not_in_list')
    expect(linkProjectRepo).not.toHaveBeenCalled()
  })

  it('compares the exact name GitHub returned, not a lookalike', async () => {
    for (const lookalike of [
      'Octo/hello',
      'octo/hello ',
      'octo/hello/',
      'octo/hell',
    ]) {
      expect(await linkRepo({ ...input, repoFullName: lookalike })).toBe(
        'not_in_list',
      )
    }
    expect(linkProjectRepo).not.toHaveBeenCalled()
  })

  it.each(['noslash', 'a/b/c', '../etc', "x/y'; drop", ''])(
    'refuses the malformed name %s before calling GitHub',
    async (name) => {
      expect(await linkRepo({ ...input, repoFullName: name })).toBe(
        'not_in_list',
      )
      expect(createInstallationToken).not.toHaveBeenCalled()
    },
  )

  it('REJECTS an installation that is not the user’s own', async () => {
    expect(await linkRepo({ ...input, installationId: 99 })).toBe(
      'no_installation',
    )
    expect(createInstallationToken).not.toHaveBeenCalled()
    expect(linkProjectRepo).not.toHaveBeenCalled()
  })

  it('REJECTS a repository another of the user’s projects already uses', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [
        { id: 'other-project', repoFullName: 'Octo/Hello', installationId: 42 },
      ],
    })
    expect(await linkRepo(input)).toBe('already_linked')
    expect(createInstallationToken).not.toHaveBeenCalled()
    expect(linkProjectRepo).not.toHaveBeenCalled()
  })

  it('lets a project be linked again to the repository it already has', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [{ id: PROJECT, repoFullName: 'octo/hello', installationId: 42 }],
    })
    expect(await linkRepo(input)).toBe('linked')
  })

  it('a project that is not the user’s is not found, and nothing is called on GitHub', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect(await linkRepo(input)).toBe('not_found')
    expect(createInstallationToken).not.toHaveBeenCalled()
    expect(linkProjectRepo).not.toHaveBeenCalled()
  })

  it('an installation GitHub no longer has is forgotten', async () => {
    createInstallationToken.mockRejectedValue(new GithubError('not_installed'))
    expect(await linkRepo(input)).toBe('no_installation')
    expect(removeGithubInstallation).toHaveBeenCalledWith(USER, 42)
  })

  it('reports GitHub trouble plainly', async () => {
    listInstallationRepos.mockRejectedValue(new GithubError('rate_limited'))
    expect(await linkRepo(input)).toBe('rate_limited')
    listInstallationRepos.mockRejectedValue(new GithubError('unavailable'))
    expect(await linkRepo(input)).toBe('unavailable')
  })

  it('reports a failed save', async () => {
    linkProjectRepo.mockResolvedValue(false)
    expect(await linkRepo(input)).toBe('failed')
  })
})

describe('unlinkRepo', () => {
  it('unlinks the user’s own project', async () => {
    expect(await unlinkRepo(USER, PROJECT)).toBe('unlinked')
    expect(unlinkProjectRepo).toHaveBeenCalledExactlyOnceWith(USER, PROJECT)
  })

  it('does nothing for a project that is not theirs', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect(await unlinkRepo(USER, PROJECT)).toBe('not_found')
    expect(unlinkProjectRepo).not.toHaveBeenCalled()
  })
})

describe('checkPostCommits', () => {
  const sha = (n: number) => n.toString(16).padStart(7, '0') + 'a'.repeat(33)

  it('returns nothing for commits that only mention the tag further down, and no untagged title', async () => {
    listRecentCommits.mockResolvedValue([
      { sha: sha(1), message: 'Add the voice settings', date: null },
      {
        sha: sha(2),
        message:
          'Squash merge (#15)\n\n* Document automatic drafts from [post] commits',
        date: null,
      },
      {
        sha: sha(3),
        message:
          'Document the tag\n\nA commit with [post] in the subject is used.',
        date: null,
      },
      { sha: sha(4), message: 'Real one [post]', date: null },
    ])
    const result = await checkPostCommits(USER, PROJECT, NOW)
    expect(result).toMatchObject({ status: 'ok' })
    if (result.status === 'ok') {
      expect(result.commits.map((c) => c.title)).toEqual(['Real one [post]'])
    }
  })

  it('mints a token for the one repository and returns only [post] commits', async () => {
    listRecentCommits.mockResolvedValue([
      {
        sha: sha(1),
        message: 'Ship it [post]\n\nlong body',
        date: '2026-10-20T10:00:00Z',
      },
      { sha: sha(2), message: 'chore: bump', date: '2026-10-21T10:00:00Z' },
      { sha: sha(3), message: 'Another [POST]', date: null },
    ])
    const result = await checkPostCommits(USER, PROJECT, NOW)
    expect(createInstallationToken).toHaveBeenCalledExactlyOnceWith(
      42,
      'octo/hello',
    )
    expect(listRecentCommits).toHaveBeenCalledWith(
      TOKEN,
      'octo/hello',
      '2026-09-27T12:00:00Z',
    )
    expect(result).toEqual({
      status: 'ok',
      repo: 'octo/hello',
      commits: [
        {
          sha: '0000001',
          title: 'Ship it [post]',
          date: '2026-10-20T10:00:00Z',
          url: `https://github.com/octo/hello/commit/${sha(1)}`,
        },
        {
          sha: '0000003',
          title: 'Another [POST]',
          date: null,
          url: `https://github.com/octo/hello/commit/${sha(3)}`,
        },
      ],
    })
  })

  it('returns at most 20', async () => {
    listRecentCommits.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({
        sha: sha(i + 1),
        message: '[post] x',
        date: null,
      })),
    )
    const result = await checkPostCommits(USER, PROJECT, NOW)
    expect(result.status === 'ok' && result.commits).toHaveLength(20)
  })

  it('never returns the token, the full message or anything else', async () => {
    listRecentCommits.mockResolvedValue([
      { sha: sha(1), message: 'Title [post]\n\nSECRET BODY', date: null },
    ])
    const result = await checkPostCommits(USER, PROJECT, NOW)
    const text = JSON.stringify(result)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('SECRET BODY')
  })

  it('a project that is not the user’s is not found, without calling GitHub', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'not_found',
    })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('a project with no repository says so', async () => {
    getProject.mockResolvedValue(
      linked({ repoFullName: null, installationId: null }),
    )
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'not_linked',
    })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('a project that lost its installation needs reconnect, without calling GitHub', async () => {
    getProject.mockResolvedValue(linked({ installationId: null }))
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'reconnect',
    })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('an uninstalled App means reconnect, and the installation is forgotten', async () => {
    createInstallationToken.mockRejectedValue(new GithubError('not_installed'))
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'reconnect',
    })
    expect(removeGithubInstallation).toHaveBeenCalledExactlyOnceWith(USER, 42)
  })

  it('a repository that is gone is reported, and the installation is kept', async () => {
    listRecentCommits.mockRejectedValue(new GithubError('not_found'))
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'repo_gone',
    })
    expect(removeGithubInstallation).not.toHaveBeenCalled()

    createInstallationToken.mockRejectedValue(new GithubError('not_found'))
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'repo_gone',
    })
  })

  it.each([
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['denied', 'failed'],
    ['failed', 'failed'],
  ])('GitHub %s becomes %s', async (kind, status) => {
    listRecentCommits.mockRejectedValue(new GithubError(kind))
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({ status })
    expect(removeGithubInstallation).not.toHaveBeenCalled()
  })

  it('an unexpected error is a generic failure', async () => {
    listRecentCommits.mockRejectedValue(new Error('boom'))
    expect(await checkPostCommits(USER, PROJECT, NOW)).toEqual({
      status: 'failed',
    })
  })

  it('does not log commit text or tokens', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    listRecentCommits.mockResolvedValue([
      { sha: sha(1), message: 'SECRET TITLE [post]', date: null },
    ])
    await checkPostCommits(USER, PROJECT, NOW)
    listRecentCommits.mockRejectedValue(new GithubError('failed'))
    await checkPostCommits(USER, PROJECT, NOW)
    const logged = JSON.stringify([log.mock.calls, warn.mock.calls])
    expect(logged).not.toContain('SECRET TITLE')
    expect(logged).not.toContain(TOKEN)
  })
})
