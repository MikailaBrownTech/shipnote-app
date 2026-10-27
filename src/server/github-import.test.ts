import { beforeEach, describe, expect, it, vi } from 'vitest'

class GithubError extends Error {
  kind: string
  constructor(kind: string) {
    super(`GitHub request failed: ${kind}`)
    this.kind = kind
  }
}

const createInstallationToken = vi.fn()
const listInstallationRepoInfo = vi.fn()
const fetchReadme = vi.fn()
const listInstallations = vi.fn()
const linkedRepos = vi.fn()
const removeGithubInstallation = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./github', () => ({
  createInstallationToken,
  listInstallationRepoInfo,
  fetchReadme,
  GithubError,
}))
vi.mock('./github-projects', () => ({ listInstallations, linkedRepos }))
vi.mock('./supabase-admin', () => ({ removeGithubInstallation }))

const { listStartRepos, prefillFromRepo, verifyRepoForLink } =
  await import('./github-import')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const SECRET_TOKEN = 'ghs_SECRET_INSTALLATION_TOKEN'
const README_SECRET = 'README SECRET CONTENT do-not-log'

const repos = [
  { fullName: 'octo/hello', name: 'hello', description: 'A greeting' },
  { fullName: 'octo/other', name: 'other', description: null },
  { fullName: 'octo/third', name: 'third', description: 'Third one' },
]
const input = { userId: USER, installationId: 42, repoFullName: 'octo/hello' }

beforeEach(() => {
  vi.clearAllMocks()
  listInstallations.mockResolvedValue([
    { installationId: 42, accountLogin: 'octo' },
  ])
  linkedRepos.mockResolvedValue(new Map())
  createInstallationToken.mockResolvedValue(SECRET_TOKEN)
  listInstallationRepoInfo.mockResolvedValue(repos)
  fetchReadme.mockResolvedValue({ found: true, text: '# Hello', cut: false })
  removeGithubInstallation.mockResolvedValue(true)
})

describe('listStartRepos', () => {
  it('lists the repositories GitHub returns for the user’s installations', async () => {
    expect(await listStartRepos(USER)).toEqual({
      status: 'ok',
      groups: [
        {
          installationId: 42,
          accountLogin: 'octo',
          repos: [
            { fullName: 'octo/hello' },
            { fullName: 'octo/other' },
            { fullName: 'octo/third' },
          ],
        },
      ],
    })
    expect(createInstallationToken).toHaveBeenCalledExactlyOnceWith(42)
  })

  it('EXCLUDES repositories already linked to one of the user’s projects', async () => {
    linkedRepos.mockResolvedValue(new Map([['octo/hello', 'project-1']]))
    const result = await listStartRepos(USER)
    expect(result.status === 'ok' && result.groups[0]?.repos).toEqual([
      { fullName: 'octo/other' },
      { fullName: 'octo/third' },
    ])
  })

  it('ignores letter case when excluding, as GitHub does', async () => {
    linkedRepos.mockResolvedValue(
      new Map([
        ['octo/hello', 'project-1'],
        ['octo/other', 'project-2'],
      ]),
    )
    const result = await listStartRepos(USER)
    expect(result.status === 'ok' && result.groups[0]?.repos).toEqual([
      { fullName: 'octo/third' },
    ])
  })

  it('says "none" when every repository is already linked', async () => {
    linkedRepos.mockResolvedValue(
      new Map(repos.map((r) => [r.fullName.toLowerCase(), 'p'])),
    )
    expect(await listStartRepos(USER)).toEqual({ status: 'none' })
  })

  it('leaves out an installation that has nothing left to offer', async () => {
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
      { installationId: 43, accountLogin: 'empty' },
    ])
    listInstallationRepoInfo
      .mockResolvedValueOnce(repos)
      .mockResolvedValueOnce([])
    const result = await listStartRepos(USER)
    expect(result.status === 'ok' && result.groups).toHaveLength(1)
  })

  it('says "none" when there is no installation', async () => {
    listInstallations.mockResolvedValue([])
    expect(await listStartRepos(USER)).toEqual({ status: 'none' })
    expect(createInstallationToken).not.toHaveBeenCalled()
  })

  it('forgets an installation GitHub no longer has', async () => {
    createInstallationToken.mockRejectedValue(new GithubError('not_installed'))
    expect(await listStartRepos(USER)).toEqual({ status: 'none' })
    expect(removeGithubInstallation).toHaveBeenCalledExactlyOnceWith(USER, 42)
  })

  it.each([
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['denied', 'failed'],
  ])('GitHub %s becomes %s', async (kind, expected) => {
    listInstallationRepoInfo.mockRejectedValue(new GithubError(kind))
    expect(await listStartRepos(USER)).toEqual({
      status: 'error',
      kind: expected,
    })
  })

  it('a database error is a plain failure', async () => {
    linkedRepos.mockResolvedValue(null)
    expect(await listStartRepos(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
    listInstallations.mockResolvedValue(null)
    linkedRepos.mockResolvedValue(new Map())
    expect(await listStartRepos(USER)).toEqual({
      status: 'error',
      kind: 'failed',
    })
  })

  it('never reads a README to build the list', async () => {
    await listStartRepos(USER)
    expect(fetchReadme).not.toHaveBeenCalled()
  })
})

describe('prefillFromRepo', () => {
  it('fills name, summary, stage and notes from the repository and its README', async () => {
    const result = await prefillFromRepo(input)
    expect(result).toEqual({
      status: 'ok',
      prefill: {
        name: 'hello',
        summary: 'A greeting',
        stage: 'in_progress',
        notes: '# Hello',
        truncated: false,
        hasReadme: true,
      },
      link: { installationId: 42, repoFullName: 'octo/hello' },
    })
  })

  it('uses a token limited to that one repository, and reads only the README', async () => {
    await prefillFromRepo(input)
    // First a metadata token to check the list, then one for this repository.
    expect(createInstallationToken).toHaveBeenNthCalledWith(1, 42)
    expect(createInstallationToken).toHaveBeenNthCalledWith(2, 42, 'octo/hello')
    expect(fetchReadme).toHaveBeenCalledExactlyOnceWith(
      SECRET_TOKEN,
      'octo/hello',
    )
  })

  it('REJECTS a repository that is not on the installation’s list, and reads nothing', async () => {
    const result = await prefillFromRepo({
      ...input,
      repoFullName: 'octo/secret-repo',
    })
    expect(result).toEqual({ status: 'not_in_list' })
    expect(fetchReadme).not.toHaveBeenCalled()
    expect(createInstallationToken).toHaveBeenCalledTimes(1)
  })

  it.each(['Octo/hello', 'octo/hello ', 'octo/hell', 'octo/hello/x'])(
    'REJECTS the lookalike %s',
    async (repoFullName) => {
      const result = await prefillFromRepo({ ...input, repoFullName })
      expect(result.status).toBe('not_in_list')
      expect(fetchReadme).not.toHaveBeenCalled()
    },
  )

  it.each(['noslash', '../../etc', "a/b'; drop table x", '', 'a/b/c'])(
    'refuses the malformed name %s before calling GitHub',
    async (repoFullName) => {
      expect(await prefillFromRepo({ ...input, repoFullName })).toEqual({
        status: 'not_in_list',
      })
      expect(createInstallationToken).not.toHaveBeenCalled()
    },
  )

  it('REJECTS an installation that is not the user’s own', async () => {
    const result = await prefillFromRepo({ ...input, installationId: 99 })
    expect(result).toEqual({ status: 'no_installation' })
    expect(createInstallationToken).not.toHaveBeenCalled()
    expect(fetchReadme).not.toHaveBeenCalled()
  })

  it('REJECTS a repository already linked to one of the user’s projects', async () => {
    linkedRepos.mockResolvedValue(new Map([['octo/hello', 'project-1']]))
    expect(await prefillFromRepo(input)).toEqual({ status: 'already_linked' })
    expect(createInstallationToken).not.toHaveBeenCalled()
    expect(fetchReadme).not.toHaveBeenCalled()
  })

  it('treats the linked check as case-insensitive', async () => {
    linkedRepos.mockResolvedValue(new Map([['octo/hello', 'project-1']]))
    const result = await prefillFromRepo({
      ...input,
      repoFullName: 'OCTO/hello',
    })
    expect(result.status).toBe('already_linked')
  })

  it('truncates a long README to 12,000 characters and says so', async () => {
    fetchReadme.mockResolvedValue({
      found: true,
      text: 'r'.repeat(20_000),
      cut: false,
    })
    const result = await prefillFromRepo(input)
    expect(
      result.status === 'ok' && Array.from(result.prefill.notes),
    ).toHaveLength(12_000)
    expect(result.status === 'ok' && result.prefill.truncated).toBe(true)
  })

  it('says so when the README was cut while being read', async () => {
    fetchReadme.mockResolvedValue({ found: true, text: 'short', cut: true })
    const result = await prefillFromRepo(input)
    expect(result.status === 'ok' && result.prefill.truncated).toBe(true)
  })

  it('trims a long name to 80 and a long description to 300 characters', async () => {
    listInstallationRepoInfo.mockResolvedValue([
      {
        fullName: 'octo/hello',
        name: 'n'.repeat(120),
        description: 'd'.repeat(500),
      },
    ])
    const result = await prefillFromRepo(input)
    expect(result.status === 'ok' && result.prefill.name).toBe('n'.repeat(80))
    expect(result.status === 'ok' && result.prefill.summary).toBe(
      'd'.repeat(300),
    )
  })

  it('a repository with no README gives empty notes', async () => {
    fetchReadme.mockResolvedValue({ found: false })
    const result = await prefillFromRepo(input)
    expect(result).toMatchObject({
      status: 'ok',
      prefill: { notes: '', hasReadme: false, truncated: false },
    })
  })

  it('stores nothing: no write function is even available to it', async () => {
    // The module imports only read functions and removeGithubInstallation (used
    // when GitHub says the app is gone). Prefill on a healthy repo calls none.
    await prefillFromRepo(input)
    expect(removeGithubInstallation).not.toHaveBeenCalled()
  })

  it('an uninstalled app is forgotten', async () => {
    createInstallationToken.mockRejectedValueOnce(
      new GithubError('not_installed'),
    )
    expect(await prefillFromRepo(input)).toEqual({ status: 'no_installation' })
    expect(removeGithubInstallation).toHaveBeenCalledExactlyOnceWith(USER, 42)
  })

  it('a repository that left the installation between the calls is "not in list"', async () => {
    fetchReadme.mockRejectedValue(new GithubError('not_found'))
    expect(await prefillFromRepo(input)).toEqual({ status: 'not_in_list' })
  })

  it.each([
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['denied', 'failed'],
    ['failed', 'failed'],
  ])('a README fetch that fails with %s becomes %s', async (kind, status) => {
    fetchReadme.mockRejectedValue(new GithubError(kind))
    expect(await prefillFromRepo(input)).toEqual({ status })
  })

  it('never logs the token or the README, on success or failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    fetchReadme.mockResolvedValue({
      found: true,
      text: README_SECRET,
      cut: false,
    })
    await prefillFromRepo(input)
    fetchReadme.mockRejectedValue(new GithubError('failed'))
    await prefillFromRepo(input)
    const logged = JSON.stringify([
      log.mock.calls,
      warn.mock.calls,
      info.mock.calls,
    ])
    expect(logged).not.toContain(SECRET_TOKEN)
    expect(logged).not.toContain('do-not-log')
  })

  it('never puts the token in its result', async () => {
    const result = await prefillFromRepo(input)
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN)
  })
})

describe('verifyRepoForLink', () => {
  it('confirms a repository on the list, using GitHub’s spelling, without reading anything', async () => {
    listInstallationRepoInfo.mockResolvedValue([
      { fullName: 'Octo/Hello', name: 'Hello', description: null },
    ])
    const result = await verifyRepoForLink({
      ...input,
      repoFullName: 'Octo/Hello',
    })
    expect(result).toEqual({
      status: 'ok',
      installationId: 42,
      repoFullName: 'Octo/Hello',
    })
    expect(fetchReadme).not.toHaveBeenCalled()
    expect(createInstallationToken).toHaveBeenCalledExactlyOnceWith(42)
  })

  it.each([
    [
      'a repository not on the list',
      { repoFullName: 'octo/nope' },
      'not_in_list',
    ],
    [
      'an installation that is not the user’s',
      { installationId: 99 },
      'no_installation',
    ],
    ['a malformed name', { repoFullName: 'a/../b' }, 'not_in_list'],
  ])('rejects %s', async (_label, change, status) => {
    expect(await verifyRepoForLink({ ...input, ...change })).toEqual({ status })
  })

  it('rejects a repository that is already linked', async () => {
    linkedRepos.mockResolvedValue(new Map([['octo/hello', 'p']]))
    expect(await verifyRepoForLink(input)).toEqual({ status: 'already_linked' })
  })

  it('reports GitHub trouble plainly', async () => {
    listInstallationRepoInfo.mockRejectedValue(new GithubError('unavailable'))
    expect(await verifyRepoForLink(input)).toEqual({ status: 'unavailable' })
  })
})
