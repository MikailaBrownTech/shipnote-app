import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The new-project page with "Start from a GitHub repo".

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const listInstallations = vi.fn()
const listStartRepos = vi.fn()
const prefillFromRepo = vi.fn()
const verifyRepoForLink = vi.fn()
const linkCreatedProject = vi.fn()
const listProjects = vi.fn()
const createProject = vi.fn()
const createProjectAction = vi.fn()
const rateLimit = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/github-app', () => ({ githubIsEnabled }))
vi.mock('@/server/github-projects', () => ({ listInstallations }))
vi.mock('@/server/github-import', () => ({
  listStartRepos,
  prefillFromRepo,
  verifyRepoForLink,
  linkCreatedProject,
}))
vi.mock('@/server/projects', () => ({ listProjects, createProject }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('../actions', () => ({ createProjectAction }))

const { default: NewProjectPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const cat = (...parts: string[]) => parts.join('')
const token = cat('gh', 'p', '_', 'aB3xY9'.repeat(6))

type Search = Record<string, string>

async function render(search: Search = {}) {
  const element: ReactElement = (
    <NewProjectPage
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

const prefill = (over: Record<string, unknown> = {}) => ({
  name: 'hello',
  summary: 'A greeting',
  stage: 'in_progress' as const,
  notes: '# Hello\n\nA readme.',
  truncated: false,
  hasReadme: true,
  ...over,
})
const prefilled = (over: Record<string, unknown> = {}) => ({
  status: 'ok' as const,
  prefill: prefill(over),
  link: { installationId: 42, repoFullName: 'octo/hello' },
})
const CHOSEN = { repo: '42|octo/hello' }

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  githubIsEnabled.mockReturnValue(true)
  listInstallations.mockResolvedValue([
    { installationId: 42, accountLogin: 'octo' },
  ])
  listProjects.mockResolvedValue({ ok: true, value: [] })
  rateLimit.mockResolvedValue(true)
  listStartRepos.mockResolvedValue({
    status: 'ok',
    groups: [
      {
        installationId: 42,
        accountLogin: 'octo',
        repos: [{ fullName: 'octo/hello' }, { fullName: 'octo/other' }],
      },
    ],
  })
  prefillFromRepo.mockResolvedValue(prefilled())
})

describe('visibility', () => {
  it('is hidden when GITHUB_ENABLED is off, with no GitHub calls', async () => {
    githubIsEnabled.mockReturnValue(false)
    const { html } = await render({ from: 'github' })
    expect(html).not.toContain('Start from a GitHub repo')
    expect(html).not.toMatch(/GitHub/)
    expect(listInstallations).not.toHaveBeenCalled()
    expect(listStartRepos).not.toHaveBeenCalled()
    expect(prefillFromRepo).not.toHaveBeenCalled()
  })

  it('is hidden when the person has no GitHub connection', async () => {
    listInstallations.mockResolvedValue([])
    const { html } = await render()
    expect(html).not.toContain('Start from a GitHub repo')
    expect(listStartRepos).not.toHaveBeenCalled()
  })

  it('is hidden when the connection cannot be read', async () => {
    listInstallations.mockResolvedValue(null)
    const { html } = await render()
    expect(html).not.toContain('Start from a GitHub repo')
  })

  it('is hidden at the 5-project cap, which shows only the limit', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [1, 2, 3, 4, 5].map((n) => ({ id: String(n) })),
    })
    const { html } = await render({ from: 'github' })
    expect(html).toContain('You have reached the 5 project limit')
    expect(html).not.toContain('Start from a GitHub repo')
    expect(listStartRepos).not.toHaveBeenCalled()
  })

  it('still requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    const { errors } = await render()
    expect(String(errors[0])).toContain('redirect:/sign-in')
    expect(listInstallations).not.toHaveBeenCalled()
  })
})

describe('connected, nothing chosen yet', () => {
  it('offers the option without calling GitHub', async () => {
    const { html } = await render()
    expect(html).toContain('Start from a GitHub repo')
    expect(html).toContain('href="/dashboard/projects/new?from=github"')
    expect(html).toContain('nothing is saved until you press Create')
    expect(listStartRepos).not.toHaveBeenCalled()
    expect(prefillFromRepo).not.toHaveBeenCalled()
    // The ordinary form is there, blank, with no repository.
    expect(html).toContain('Create project')
    expect(html).not.toContain('name="github_repo"')
  })
})

describe('the repository list', () => {
  it('lists the repositories the server returned, grouped by account', async () => {
    const { html } = await render({ from: 'github' })
    expect(html).toContain('<optgroup label="octo">')
    expect(html).toContain('value="42|octo/hello"')
    expect(html).toContain('value="42|octo/other"')
    expect(html).toContain(
      'Repositories already linked to one of your projects are not listed',
    )
    expect(listStartRepos).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('is a plain GET form, so choosing can only read', async () => {
    const { html } = await render({ from: 'github' })
    expect(html).toMatch(
      /<form class="[^"]*" action="\/dashboard\/projects\/new" method="get">/,
    )
    expect(html).toContain('Use this repo')
  })

  it('shows only what the server returned (it excludes linked repos)', async () => {
    listStartRepos.mockResolvedValue({
      status: 'ok',
      groups: [
        {
          installationId: 42,
          accountLogin: 'octo',
          repos: [{ fullName: 'octo/other' }],
        },
      ],
    })
    const { html } = await render({ from: 'github' })
    expect(html).toContain('value="42|octo/other"')
    expect(html).not.toContain('value="42|octo/hello"')
  })

  it('renders a hostile account or repo name as text', async () => {
    listStartRepos.mockResolvedValue({
      status: 'ok',
      groups: [
        {
          installationId: 42,
          accountLogin: '<img src=x>',
          repos: [{ fullName: 'octo/<b>x' }],
        },
      ],
    })
    const { html } = await render({ from: 'github' })
    expect(html).not.toContain('<img src=x>')
    expect(html).not.toContain('<b>x')
  })

  it.each([
    [{ status: 'none' }, 'no repositories left to start from'],
    [{ status: 'error', kind: 'rate_limited' }, 'limiting requests'],
    [{ status: 'error', kind: 'unavailable' }, 'not responding'],
    [{ status: 'error', kind: 'failed' }, 'could not load that repository'],
  ])('says so for %j', async (choices, words) => {
    listStartRepos.mockResolvedValue(choices)
    const { html } = await render({ from: 'github' })
    expect(html).toContain(words)
    expect(html).not.toContain('name="repo"')
  })

  it('is rate limited before GitHub is asked', async () => {
    rateLimit.mockImplementation((name: string) =>
      Promise.resolve(name !== 'githubRepos'),
    )
    const { html } = await render({ from: 'github' })
    expect(html).toContain('Too many attempts')
    expect(listStartRepos).not.toHaveBeenCalled()
  })
})

describe('choosing a repository fills the form', () => {
  it('asks the server for the choice, for the session user', async () => {
    await render(CHOSEN)
    expect(prefillFromRepo).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      installationId: 42,
      repoFullName: 'octo/hello',
    })
    expect(rateLimit).toHaveBeenCalledWith('githubPrefill', USER)
  })

  it('fills name, summary, stage and notes', async () => {
    const { html } = await render(CHOSEN)
    expect(html).toContain('value="hello"')
    expect(html).toContain('>A greeting</textarea>')
    expect(html).toContain('# Hello')
    expect(html).toMatch(
      /<input[^>]*value="in_progress"[^>]*checked=""|<input[^>]*checked=""[^>]*value="in_progress"/,
    )
  })

  it('carries the repository in two hidden fields, to be checked again on save', async () => {
    const { html } = await render(CHOSEN)
    expect(html).toContain('name="github_installation"')
    expect(html).toContain('value="42"')
    expect(html).toContain('name="github_repo"')
    expect(html).toContain('value="octo/hello"')
  })

  it('tells the person it is only filled in and nothing is saved yet', async () => {
    const { html } = await render(CHOSEN)
    expect(html).toContain('Filled in from <strong>octo/hello</strong>')
    expect(html).toContain('Nothing is saved until you do')
  })

  it('PREFILL DOES NOT SAVE: nothing is created, verified or linked while rendering', async () => {
    await render(CHOSEN)
    await render({ from: 'github' })
    await render()
    expect(createProject).not.toHaveBeenCalled()
    expect(createProjectAction).not.toHaveBeenCalled()
    expect(verifyRepoForLink).not.toHaveBeenCalled()
    expect(linkCreatedProject).not.toHaveBeenCalled()
  })

  it('tells the person when the README was cut', async () => {
    prefillFromRepo.mockResolvedValue(prefilled({ truncated: true }))
    const { html } = await render(CHOSEN)
    expect(html).toContain('only the first 12,000 characters were copied')
    expect(html).toContain('Check the notes before you save')
  })

  it('does not say so when it was not cut', async () => {
    const { html } = await render(CHOSEN)
    expect(html).not.toContain('only the first')
  })

  it('tells the person when there is no README', async () => {
    prefillFromRepo.mockResolvedValue(
      prefilled({ notes: '', hasReadme: false }),
    )
    const { html } = await render(CHOSEN)
    expect(html).toContain(
      'This repository has no README, so the notes are empty',
    )
  })

  it('warns, before saving, if the README looks like it contains a secret, without showing it', async () => {
    prefillFromRepo.mockResolvedValue(
      prefilled({ notes: cat('# Setup\n\nexport TOKEN=', token) }),
    )
    const { html } = await render(CHOSEN)
    expect(html).toContain('a GitHub token on line 3')
    expect(html).toContain('You will need to remove it before you can save')
    // The text itself is in the editable notes, where the person can remove it,
    // but it is not repeated in the warning.
    const warning = html.slice(
      html.indexOf('Possible secret'),
      html.indexOf('Possible secret') + 220,
    )
    expect(warning).not.toContain(token)
  })

  it('shows README text as plain text, never as markup', async () => {
    prefillFromRepo.mockResolvedValue(
      prefilled({
        name: '<img src=x onerror=alert(1)>',
        summary: '<script>alert(1)</script>',
        notes: '<script>alert(2)</script>',
      }),
    )
    const { html } = await render(CHOSEN)
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })
})

describe('a choice that cannot be used', () => {
  it.each([
    ['not_in_list', 'not available through your GitHub connection'],
    ['already_linked', 'already linked to one of your projects'],
    ['no_installation', 'no longer has access to GitHub'],
    ['rate_limited', 'limiting requests'],
    ['unavailable', 'not responding'],
    ['failed', 'could not load that repository'],
  ])(
    '%s shows a plain message, a blank form and no repository',
    async (status, words) => {
      prefillFromRepo.mockResolvedValue({ status })
      const { html } = await render(CHOSEN)
      expect(html).toContain(words)
      expect(html).toContain('Choose another repository')
      expect(html).not.toContain('name="github_repo"')
      expect(html).not.toContain('value="hello"')
    },
  )

  it.each([
    ['no separator', 'octo/hello'],
    ['a path', '../../etc/passwd'],
    ['a non-numeric installation', 'x|octo/hello'],
    ['a markup repo', '42|<script>'],
    ['an empty value', ''],
    ['a name with no owner', '42|hello'],
  ])(
    'a malformed repo value (%s) never reaches GitHub',
    async (_label, repo) => {
      const { html } = await render({ repo })
      expect(prefillFromRepo).not.toHaveBeenCalled()
      expect(html).toContain('not available through your GitHub connection')
      expect(html).not.toContain('name="github_repo"')
    },
  )

  it('does not echo the URL value back', async () => {
    const { html } = await render({ repo: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert')
  })

  it('is rate limited before GitHub is asked', async () => {
    rateLimit.mockImplementation((name: string) =>
      Promise.resolve(name !== 'githubPrefill'),
    )
    const { html } = await render(CHOSEN)
    expect(html).toContain('Too many attempts')
    expect(prefillFromRepo).not.toHaveBeenCalled()
  })
})

describe('logs', () => {
  it('never contain a token or README text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    prefillFromRepo.mockResolvedValue(
      prefilled({ notes: 'README SECRET TEXT do-not-log' }),
    )
    await render(CHOSEN)
    prefillFromRepo.mockResolvedValue({ status: 'failed' })
    await render(CHOSEN)
    const logged = JSON.stringify([
      log.mock.calls,
      warn.mock.calls,
      info.mock.calls,
    ])
    expect(logged).not.toContain('do-not-log')
  })
})
