import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The GitHub page, rendered on the server: what is on it in each state.

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const aiIsEnabled = vi.fn()
const rateLimit = vi.fn()
const loadGithubOverview = vi.fn()
const checkPostCommits = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/github-app', () => ({ githubIsEnabled }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/github-overview', () => ({ loadGithubOverview }))
vi.mock('@/server/github-projects', () => ({ checkPostCommits }))
vi.mock('./actions', () => ({
  connectGithubAction: vi.fn(),
  disconnectGithubFromDashboardAction: vi.fn(),
  syncGithubAction: vi.fn(),
}))

const { default: GithubPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const READ_AT = Date.parse('2026-10-27T10:24:00Z')

const repo = (over: Record<string, unknown> = {}) => ({
  fullName: 'octo/proposal-generator',
  name: 'proposal-generator',
  description: 'Internal tool for ClearPath IT compliance services',
  isPrivate: true,
  language: 'TypeScript',
  stars: 12,
  forks: 4,
  openIssues: 2,
  updatedAt: '2026-10-27T08:24:00Z',
  installationId: 42,
  projectId: PROJECT,
  ...over,
})

const repos = [
  repo(),
  repo({
    fullName: 'octo/maintenance-tracker',
    name: 'maintenance-tracker',
    description: 'Track and manage system maintenance tasks',
    isPrivate: false,
    stars: 8,
    forks: 3,
    updatedAt: '2026-10-26T10:24:00Z',
    projectId: '22222222-2222-4333-8444-555555555555',
  }),
  repo({
    fullName: 'octo/epitrack',
    name: 'epitrack',
    description: 'Epidemic tracking and reporting dashboard',
    language: 'Python',
    stars: 9,
    updatedAt: '2026-10-24T10:24:00Z',
    projectId: '33333333-2222-4333-8444-555555555555',
  }),
]

const overview = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  accounts: [
    {
      installationId: 42,
      login: 'MikailaBrownTech',
      connectedAt: '2026-10-20T10:00:00Z',
    },
  ],
  repos,
  unlinked: 0,
  readAt: READ_AT,
  ...over,
})

async function render(search: Record<string, string> = {}) {
  const element: ReactElement = (
    <GithubPage
      params={Promise.resolve({})}
      searchParams={Promise.resolve(search)}
    />
  )
  const errors: unknown[] = []
  const stream = await renderToReadableStream(element, {
    onError: (error) => {
      errors.push(error)
    },
  })
  await stream.allReady
  const html = (await new Response(stream).text()).replaceAll('<!-- -->', '')
  return { html, errors }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  githubIsEnabled.mockReturnValue(true)
  aiIsEnabled.mockReturnValue(true)
  rateLimit.mockResolvedValue(true)
  loadGithubOverview.mockResolvedValue(overview())
  checkPostCommits.mockResolvedValue({
    status: 'ok',
    repo: 'octo/proposal-generator',
    commits: [
      {
        sha: '2a3f9c1',
        title: 'Added real-time notifications [post]',
        date: '2026-10-27T08:24:00Z',
        url: 'https://github.com/octo/proposal-generator/commit/2a3f9c1',
      },
    ],
  })
})

describe('the states', () => {
  it('needs a signed-in user and reads only their own connection', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
    expect(loadGithubOverview).toHaveBeenCalledExactlyOnceWith(USER)
    expect(rateLimit).toHaveBeenCalledWith('githubOverview', USER)
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    loadGithubOverview.mockClear()
    const denied = await render()
    expect(String(denied.errors[0])).toContain('redirect:/sign-in')
    expect(loadGithubOverview).not.toHaveBeenCalled()
  })

  it('says GitHub is off, and reads nothing', async () => {
    githubIsEnabled.mockReturnValue(false)
    const { html } = await render()
    expect(html).toContain('GitHub is switched off right now.')
    expect(loadGithubOverview).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('is rate limited, and reads nothing from GitHub', async () => {
    rateLimit.mockResolvedValue(false)
    const { html } = await render()
    expect(html).toContain('Too many refreshes.')
    expect(loadGithubOverview).not.toHaveBeenCalled()
  })

  it('offers to connect when there is no connection', async () => {
    loadGithubOverview.mockResolvedValue({ status: 'none' })
    const { html } = await render()
    expect(html).toContain('Connect GitHub')
    expect(html).toContain('Shipnote never posts for you.')
    expect(html).not.toContain('Sync now')
  })

  it.each([
    ['rate_limited', 'GitHub is limiting requests right now.'],
    ['unavailable', 'We could not reach GitHub.'],
    ['failed', 'We could not reach GitHub.'],
  ])('a %s failure is a plain message', async (kind, words) => {
    loadGithubOverview.mockResolvedValue({ status: 'error', kind })
    const { html } = await render()
    expect(html).toContain(words)
    expect(html).not.toContain('Your repositories')
  })
})

describe('the connected page', () => {
  it('shows the title, Sync now and when GitHub was read, in UTC', async () => {
    const { html } = await render()
    expect(html).toContain('<h1>GitHub</h1>')
    expect(html).toContain('Connect and explore your development activity.')
    expect(html).toContain('Sync now')
    expect(html).toContain('Read from GitHub at 10:24 AM UTC')
  })

  it('shows the connection, with View on GitHub and Disconnect', async () => {
    const { html } = await render()
    expect(html).toContain('Connected as <strong>MikailaBrownTech</strong>')
    expect(html).toContain('>Connected<')
    expect(html).toContain('Since <time dateTime="2026-10-20T10:00:00Z">')
    expect(html).toContain('href="https://github.com/MikailaBrownTech"')
    expect(html).toContain('Disconnect GitHub')
  })

  it('shows the tabs that can be built from what Shipnote may read', async () => {
    const { html } = await render()
    expect(html).toContain('>Repositories<')
    expect(html).toContain('>Commits<')
    expect(html).not.toContain('Pull requests')
    expect(html).not.toContain('Releases')
  })

  it('lists each repository with language, stars, forks and when it changed', async () => {
    const { html } = await render()
    expect(html).toContain('Your repositories')
    expect(html).toMatch(/Your repositories <span[^>]*>3<\/span>/)
    for (const name of [
      'proposal-generator',
      'maintenance-tracker',
      'epitrack',
    ]) {
      expect(html).toContain(`>${name}</a>`)
    }
    expect(html).toContain('TypeScript')
    expect(html).toContain('Python')
    expect(html).toContain('Updated 2 hours ago')
    expect(html).toContain('Updated 1 day ago')
    expect(html).toContain('Updated 3 days ago')
    expect(html.match(/View activity/g)).toHaveLength(3)
  })

  it('has a search and a sort', async () => {
    const { html } = await render()
    expect(html).toContain('role="search"')
    expect(html).toContain('Search repositories…')
    for (const label of ['Recently updated', 'Name', 'Most stars']) {
      expect(html).toContain(`>${label}</option>`)
    }
  })

  it('details the first repository, and the one picked in the address', async () => {
    const first = await render()
    const side =
      first.html.split('aria-label="Repository details and actions"')[1] ?? ''
    expect(side).toContain('<h2 id="details-title">proposal-generator</h2>')
    expect(side).toContain('Private')
    expect(side).toContain('Open in GitHub')
    expect(side).toContain('href="https://github.com/octo/proposal-generator"')
    const picked = await render({ repo: 'octo/maintenance-tracker' })
    const pickedSide =
      picked.html.split('aria-label="Repository details and actions"')[1] ?? ''
    expect(pickedSide).toContain(
      '<h2 id="details-title">maintenance-tracker</h2>',
    )
    expect(pickedSide).toContain('Public')
  })

  it('ignores a repository in the address that is not one of the user’s', async () => {
    for (const bad of ['other/repo', '../x', '"><script>alert(1)</script>']) {
      const { html } = await render({ repo: bad })
      expect(html).toContain('<h2 id="details-title">proposal-generator</h2>')
      expect(html).not.toContain('<script>alert')
    }
  })

  it('filters by search and sorts', async () => {
    const found = await render({ q: 'epidemic' })
    expect(found.html).toContain('>epitrack</a>')
    expect(found.html).not.toContain('>maintenance-tracker</a>')
    const none = await render({ q: 'zzz' })
    expect(none.html).toContain('No repositories match your search.')
    const byName = await render({ sort: 'name' })
    const order = [
      ...byName.html.matchAll(/<h3><a[^>]*>([^<]+)<\/a><\/h3>/g),
    ].map((m) => m[1])
    expect(order).toEqual([
      'epitrack',
      'maintenance-tracker',
      'proposal-generator',
    ])
  })

  it('on the Commits tab shows the activity and not the repository list', async () => {
    const { html } = await render({ tab: 'commits' })
    expect(html).not.toContain('Your repositories')
    expect(html).toContain('Recent activity')
    expect(html).toContain('Added real-time notifications [post]')
  })

  it('an odd tab or sort falls back to the defaults', async () => {
    const { html } = await render({ tab: 'releases', sort: 'drop table' })
    expect(html).toContain('Your repositories')
  })

  it('shows repository text as text, never as markup', async () => {
    loadGithubOverview.mockResolvedValue(
      overview({
        repos: [
          repo({
            name: '<img src=x onerror=alert(1)>',
            fullName: 'octo/safe',
            description: '<script>alert(1)</script>',
            language: 'red;background:url(x)',
          }),
        ],
      }),
    )
    const { html } = await render()
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    // A language name is only text; the colour comes from a fixed list.
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1])
    expect(styles).toEqual(['background:#9a95b0'])
  })

  it('says when no repository is connected to a project, and how to connect one', async () => {
    loadGithubOverview.mockResolvedValue(overview({ repos: [] }))
    const { html } = await render()
    expect(html).toContain('No repository is connected to a project yet.')
    expect(html).toContain('href="/dashboard/projects/new"')
    expect(checkPostCommits).not.toHaveBeenCalled()
  })

  it('says how many other repositories are not shown, without naming them', async () => {
    loadGithubOverview.mockResolvedValue(overview({ unlinked: 3 }))
    const many = await render()
    expect(many.html).toContain(
      '3 other repositories the Shipnote app can see are not linked to a project, so they are not shown.',
    )
    loadGithubOverview.mockResolvedValue(overview({ unlinked: 1 }))
    const one = await render()
    expect(one.html).toContain(
      '1 other repository the Shipnote app can see is not linked to a project, so it is not shown.',
    )
    loadGithubOverview.mockResolvedValue(overview({ unlinked: 0 }))
    expect((await render()).html).not.toContain('not shown')
  })

  it('a repository in the address that is not connected is ignored', async () => {
    const { html } = await render({ repo: 'octo/not-connected' })
    expect(html).toContain('<h2 id="details-title">proposal-generator</h2>')
  })
})

describe('recent activity', () => {
  it('shows the [post] commits of a linked repository, for this user and project', async () => {
    const { html } = await render()
    expect(checkPostCommits).toHaveBeenCalledExactlyOnceWith(
      USER,
      PROJECT,
      READ_AT,
    )
    expect(html).toContain('Added real-time notifications [post]')
    expect(html).toContain('<code>2a3f9c1</code>')
    expect(html).toContain('proposal-generator · 2 hours ago')
    expect(html).toContain(`href="/dashboard/projects/${PROJECT}?tab=drafts"`)
    expect(html).toContain('Generate post')
  })

  it('offers no Generate post while drafting is off', async () => {
    aiIsEnabled.mockReturnValue(false)
    const { html } = await render()
    expect(html).toContain('Added real-time notifications [post]')
    expect(html).not.toContain('Generate post')
  })

  it('shows a commit title as text', async () => {
    checkPostCommits.mockResolvedValue({
      status: 'ok',
      repo: 'octo/proposal-generator',
      commits: [
        {
          sha: 'abc1234',
          title: '<script>alert(1)</script> [post]',
          date: null,
          url: 'https://github.com/x',
        },
      ],
    })
    const { html } = await render()
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('unknown')
  })

  it('says when there are no tagged commits', async () => {
    checkPostCommits.mockResolvedValue({
      status: 'ok',
      repo: 'x/y',
      commits: [],
    })
    const { html } = await render()
    expect(html).toContain('No commits tagged')
  })

  it.each([
    ['reconnect', 'GitHub needs to be reconnected for this project.'],
    ['repo_gone', 'GitHub no longer lets Shipnote see this repository.'],
    ['rate_limited', 'GitHub is limiting requests right now.'],
    ['unavailable', 'We could not reach GitHub.'],
    ['failed', 'Something went wrong. Try again.'],
  ])('a %s answer is a plain message', async (status, words) => {
    checkPostCommits.mockResolvedValue({ status })
    const { html } = await render()
    expect(html).toContain(words)
  })
})

describe('recent activity is paged', () => {
  const commits = Array.from({ length: 12 }, (_, i) => ({
    sha: String(i + 1).padStart(7, '0'),
    title: `Commit title ${String(i + 1)} [post]`,
    date: '2026-10-27T08:24:00Z',
    url: 'https://github.com/x',
  }))

  beforeEach(() => {
    checkPostCommits.mockResolvedValue({
      status: 'ok',
      repo: 'octo/x',
      commits,
    })
  })

  it('shows five commits a page, with links for the others', async () => {
    const { html } = await render()
    expect(html).toContain('Commit title 5 [post]')
    expect(html).not.toContain('Commit title 6 [post]')
    expect(html).toContain('Page 1 of 3')
    expect(html).toContain('12 commits')
    expect(html).toContain(
      'href="/dashboard/github?repo=octo%2Fproposal-generator&amp;ap=2"',
    )
  })

  it('shows the page named in the address, and the last page when it is too far', async () => {
    const second = await render({ ap: '2' })
    expect(second.html).toContain('Commit title 6 [post]')
    expect(second.html).toContain('Commit title 10 [post]')
    expect(second.html).not.toContain('Commit title 5 [post]')
    expect(second.html).toContain('Page 2 of 3')
    const last = await render({ ap: '99' })
    expect(last.html).toContain('Page 3 of 3')
    expect(last.html).toContain('Commit title 11 [post]')
    expect(last.html).toContain('Commit title 12 [post]')
    expect(last.html).not.toContain('Commit title 10 [post]')
  })

  it('an odd page number is the first page', async () => {
    for (const bad of ['0', '-1', 'x', '1.5', '<script>alert(1)</script>']) {
      const { html } = await render({ ap: bad })
      expect(html).toContain('Page 1 of 3')
      expect(html).not.toContain('alert(1)')
    }
  })

  it('has no pager for five commits or fewer', async () => {
    checkPostCommits.mockResolvedValue({
      status: 'ok',
      repo: 'octo/x',
      commits: commits.slice(0, 5),
    })
    const { html } = await render()
    expect(html).not.toContain('commits pages')
  })
})

describe('the rail', () => {
  it('has quick actions and tips, and never a way to post', async () => {
    const { html } = await render()
    expect(html).toContain('Quick actions')
    expect(html).toContain('View recent commits')
    expect(html).toContain('Generate post from activity')
    expect(html).toContain('Tips for great posts')
    expect(html).toContain('Tag meaningful commits with [post]')
    expect(html).not.toMatch(/Publish now|Post now/)
  })
})
