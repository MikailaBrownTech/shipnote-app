import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

class GithubError extends Error {
  kind: string
  constructor(kind: string) {
    super(`GitHub request failed: ${kind}`)
    this.kind = kind
  }
}

const calls: { method: string; args: unknown[] }[] = []
let result: Result = { data: [], error: null }
const createInstallationToken = vi.fn()
const listInstallationRepoInfo = vi.fn()
const listProjects = vi.fn()
const removeGithubInstallation = vi.fn()

const chain: object = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (property === 'then') {
        return (resolve: (value: Result) => unknown) => resolve(result)
      }
      return (...args: unknown[]) => {
        calls.push({ method: property, args })
        return chain
      }
    },
  },
)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: (table: string) => {
        calls.push({ method: 'from', args: [table] })
        return chain
      },
    }),
}))
vi.mock('./github', () => ({
  createInstallationToken,
  listInstallationRepoInfo,
  GithubError,
}))
vi.mock('./projects', () => ({ listProjects }))
vi.mock('./supabase-admin', () => ({ removeGithubInstallation }))

const { loadGithubOverview } = await import('./github-overview')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'ghs_SECRET_TOKEN_VALUE'

const row = (id = 42, login = 'octo') => ({
  installation_id: id,
  account_login: login,
  created_at: '2026-10-20T10:00:00Z',
})
const info = (fullName: string, over: Record<string, unknown> = {}) => ({
  fullName,
  name: fullName.split('/')[1],
  description: null,
  isPrivate: false,
  language: 'TypeScript',
  stars: 3,
  forks: 1,
  openIssues: 0,
  updatedAt: '2026-10-27T10:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  result = { data: [row()], error: null }
  createInstallationToken.mockResolvedValue(TOKEN)
  listInstallationRepoInfo.mockResolvedValue([
    info('octo/hello'),
    info('octo/other'),
  ])
  listProjects.mockResolvedValue({
    ok: true,
    value: [{ id: PROJECT, repoFullName: 'Octo/Hello' }],
  })
  removeGithubInstallation.mockResolvedValue(true)
})

describe('loadGithubOverview', () => {
  it('reads only the user’s own connections, then each one’s repositories', async () => {
    const overview = await loadGithubOverview(USER)
    expect(overview).toMatchObject({
      status: 'ok',
      accounts: [
        {
          installationId: 42,
          login: 'octo',
          connectedAt: '2026-10-20T10:00:00Z',
        },
      ],
    })
    expect(calls.find((c) => c.method === 'from')?.args).toEqual([
      'github_installations',
    ])
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['user_id', USER],
    ])
    expect(createInstallationToken).toHaveBeenCalledExactlyOnceWith(42)
    expect(listInstallationRepoInfo).toHaveBeenCalledExactlyOnceWith(TOKEN)
  })

  it('lists only the repositories that belong to a project, ignoring case', async () => {
    const overview = await loadGithubOverview(USER)
    if (overview.status !== 'ok') throw new Error('expected ok')
    expect(
      overview.repos.map((r) => [r.fullName, r.projectId, r.installationId]),
    ).toEqual([['octo/hello', PROJECT, 42]])
  })

  it('counts the repositories it does not list, and never names them', async () => {
    const overview = await loadGithubOverview(USER)
    if (overview.status !== 'ok') throw new Error('expected ok')
    expect(overview.unlinked).toBe(1)
    expect(JSON.stringify(overview)).not.toContain('octo/other')
  })

  it('no connected repository at all is an empty list, not an error', async () => {
    listProjects.mockResolvedValue({ ok: true, value: [] })
    const overview = await loadGithubOverview(USER)
    expect(overview).toMatchObject({ status: 'ok', repos: [], unlinked: 2 })
  })

  it('is a failure if the projects cannot be read, rather than guessing', async () => {
    listProjects.mockResolvedValue({ ok: false })
    expect(await loadGithubOverview(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('says none when there is no connection, without calling GitHub', async () => {
    result = { data: [], error: null }
    expect(await loadGithubOverview(USER)).toEqual({ status: 'none' })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('an error or an odd row from the database is a failure', async () => {
    result = { data: null, error: { code: '42501' } }
    expect(await loadGithubOverview(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
    result = { data: [{ installation_id: 'x' }], error: null }
    expect(await loadGithubOverview(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
  })

  it('looks at no more than five connections', async () => {
    result = {
      data: Array.from({ length: 8 }, (_, i) =>
        row(100 + i, `acct${String(i)}`),
      ),
      error: null,
    }
    await loadGithubOverview(USER)
    expect(createInstallationToken).toHaveBeenCalledTimes(5)
  })

  it('forgets a connection the App was removed from on GitHub', async () => {
    result = { data: [row(42, 'gone'), row(43, 'here')], error: null }
    createInstallationToken.mockImplementation((id: number) =>
      id === 42
        ? Promise.reject(new GithubError('not_installed'))
        : Promise.resolve(TOKEN),
    )
    const overview = await loadGithubOverview(USER)
    expect(removeGithubInstallation).toHaveBeenCalledExactlyOnceWith(USER, 42)
    if (overview.status !== 'ok') throw new Error('expected ok')
    expect(overview.accounts.map((a) => a.login)).toEqual(['here'])
  })

  it('none when every connection is gone', async () => {
    createInstallationToken.mockRejectedValue(new GithubError('not_installed'))
    expect(await loadGithubOverview(USER)).toEqual({ status: 'none' })
  })

  it.each([
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['denied', 'failed'],
  ])('a %s answer from GitHub is %s', async (kind, expected) => {
    listInstallationRepoInfo.mockRejectedValue(new GithubError(kind))
    expect(await loadGithubOverview(USER)).toEqual({
      status: 'error',
      kind: expected,
    })
    expect(removeGithubInstallation).not.toHaveBeenCalled()
  })

  it('an unexpected error is a failure, and nothing is logged', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    createInstallationToken.mockRejectedValue(new Error(TOKEN))
    expect(await loadGithubOverview(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(TOKEN)
  })
})
