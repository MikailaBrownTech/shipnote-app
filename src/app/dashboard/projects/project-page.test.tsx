import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The project page layout, with GitHub on and off.

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const listInstallations = vi.fn()
const getProject = vi.fn()

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
vi.mock('@/server/projects', () => ({ getProject }))
vi.mock('../github/actions', () => ({ connectGithubAction: vi.fn() }))
vi.mock('./actions', () => ({
  createProjectAction: vi.fn(),
  updateProjectAction: vi.fn(),
  deleteProjectAction: vi.fn(),
}))
vi.mock('./github-actions', () => ({
  linkRepoAction: vi.fn(),
  unlinkRepoAction: vi.fn(),
  disconnectGithubAction: vi.fn(),
  checkCommitsAction: vi.fn(),
}))

const { default: ProjectPage } = await import('./[id]/page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'

const project = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Proposal Generator',
  summary: 'An internal tool',
  stage: 'in_progress',
  notes: 'line one\nline two',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-27T11:00:00Z',
  repoFullName: null,
  installationId: null,
  ...over,
})

async function render(search: Record<string, string> = {}) {
  const element: ReactElement = (
    <ProjectPage
      params={Promise.resolve({ id: ID })}
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

describe('the project page layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    githubIsEnabled.mockReturnValue(true)
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
    ])
    getProject.mockResolvedValue({ ok: true, value: project() })
  })

  it('has a back link, the header, tabs, status, progress, notes and a details column', async () => {
    const { html } = await render()
    expect(html).toContain('Back to projects')
    expect(html).toContain('href="/dashboard#projects-title"')
    expect(html).toContain('<h1>Proposal Generator</h1>')
    expect(html).toContain('aria-label="Sections of this project"')
    expect(html).toContain('href="#overview"')
    expect(html).toContain('href="#notes"')
    expect(html).toContain('Project stage')
    expect(html).toContain('Turn your progress into LinkedIn content')
    expect(html).toContain('Project details')
    expect(html).toContain('Quick actions')
    expect(html).toContain('id="notes"')
  })

  it('shows the details: name, summary, stage and both dates', async () => {
    const { html } = await render()
    expect(html).toContain('<dt>Name</dt><dd>Proposal Generator</dd>')
    expect(html).toContain('<dt>Summary</dt><dd>An internal tool</dd>')
    expect(html).toContain('<dt>Stage</dt><dd>In progress</dd>')
    expect(html).toContain('Oct 20, 2026')
    expect(html).toContain('Oct 27, 2026')
  })

  it('says so when there is no summary or no notes', async () => {
    getProject.mockResolvedValue({
      ok: true,
      value: project({ summary: null, notes: '' }),
    })
    const { html } = await render()
    expect(html).toContain('No summary')
    expect(html).toContain('No notes yet')
  })

  it('does not promise drafts or posting: drafts are marked coming soon', async () => {
    const { html } = await render()
    expect(html).toContain('Drafts (coming soon)')
    expect(html).toContain('Shipnote never posts')
    expect(html).not.toMatch(/Generate post|Schedule|Archive|Duplicate/i)
  })

  it('renders every piece of project text as plain text', async () => {
    getProject.mockResolvedValue({
      ok: true,
      value: project({
        name: '<img src=x onerror=alert(1)>',
        summary: '<script>alert(1)</script>',
        notes: '<b>bold</b><script>alert(2)</script>',
      }),
    })
    const { html } = await render()
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<b>bold')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })

  it('has Edit and Delete in the header and the quick actions', async () => {
    const { html } = await render()
    expect(html).toContain(`href="/dashboard/projects/${ID}/edit"`)
    expect(html).toContain('Delete project')
  })

  it('a project that is not the user’s is the not-found page', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    const { errors } = await render()
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
  })

  describe('with GitHub on', () => {
    it('shows the GitHub tab, the connection card and the repository choice', async () => {
      const { html } = await render()
      expect(html).toContain('href="#github"')
      expect(html).toContain('GitHub connection')
      expect(html).toContain('No repository linked')
      expect(html).toContain('Choose a repository')
      expect(html).not.toContain('View on GitHub')
    })

    it('a linked project shows Connected, the repository and a link to it', async () => {
      getProject.mockResolvedValue({
        ok: true,
        value: project({ repoFullName: 'octo/hello', installationId: 42 }),
      })
      const { html } = await render()
      expect(html).toContain('Connected')
      expect(html).toContain('octo/hello')
      expect(html).toContain('href="https://github.com/octo/hello"')
      expect(html).toMatch(/rel="noreferrer noopener"/)
      expect(html).toContain('Change repository')
      expect(html).toContain('Check for [post] commits')
    })

    it('a project that lost its installation shows Needs reconnect', async () => {
      getProject.mockResolvedValue({
        ok: true,
        value: project({ repoFullName: 'octo/hello', installationId: null }),
      })
      const { html } = await render()
      expect(html).toContain('Needs reconnect')
      expect(html).toContain('Reconnect GitHub')
    })

    it('shows the message after a connect attempt, at the top, as fixed text', async () => {
      const { html } = await render({ github: 'connected' })
      expect(html).toContain('GitHub connected')
      expect(html.indexOf('GitHub connected')).toBeLessThan(
        html.indexOf('GitHub connection'),
      )
    })

    it('ignores any other value and never echoes it', async () => {
      const { html } = await render({ github: '<script>alert(1)</script>' })
      expect(html).not.toContain('<script>alert')
    })
  })

  describe('with GitHub off', () => {
    beforeEach(() => {
      githubIsEnabled.mockReturnValue(false)
    })

    it('shows nothing about GitHub: no tab, card, link or message', async () => {
      getProject.mockResolvedValue({
        ok: true,
        value: project({ repoFullName: 'octo/hello', installationId: 42 }),
      })
      const { html } = await render({ github: 'connected' })
      expect(html).not.toMatch(/GitHub/i)
      expect(html).not.toContain('href="#github"')
      expect(html).not.toContain('github.com')
      expect(listInstallations).not.toHaveBeenCalled()
    })

    it('still shows the stage card, details and notes', async () => {
      const { html } = await render()
      expect(html).toContain('Project stage')
      expect(html).toContain('Project details')
      expect(html).toContain('line one')
    })
  })
})
