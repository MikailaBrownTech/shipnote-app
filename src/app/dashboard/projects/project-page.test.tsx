import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The project page: header, tabs that each show their own content, and the
// details column, with GitHub on and off.

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
const PATH = `/dashboard/projects/${ID}`

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
const linked = () => project({ repoFullName: 'octo/hello', installationId: 42 })

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

// What identifies each tab's own content.
const OVERVIEW = 'Turn your progress into LinkedIn content'
const GITHUB = 'Check for [post] commits'
const NOTES = 'id="notes-title"'

describe('the project page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    githubIsEnabled.mockReturnValue(true)
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
    ])
    getProject.mockResolvedValue({ ok: true, value: linked() })
  })

  describe('always', () => {
    it('has a back link, the header and the details column on every tab', async () => {
      for (const tab of ['overview', 'github', 'notes']) {
        const { html } = await render({ tab })
        expect(html).toContain('Back to projects')
        expect(html).toContain('href="/dashboard#projects-title"')
        expect(html).toContain('<h1>Proposal Generator</h1>')
        expect(html).toContain('Project details')
        expect(html).toContain('Quick actions')
        expect(html).toContain('Delete project')
        expect(html).toContain(`href="${PATH}/edit"`)
      }
    })

    it('shows the details: name, summary, stage and both dates', async () => {
      const { html } = await render()
      expect(html).toContain('<dt>Name</dt><dd>Proposal Generator</dd>')
      expect(html).toContain('<dt>Summary</dt><dd>An internal tool</dd>')
      expect(html).toContain('<dt>Stage</dt><dd>In progress</dd>')
      expect(html).toContain('Oct 20, 2026')
      expect(html).toContain('Oct 27, 2026')
    })

    it('a project that is not the user’s is the not-found page', async () => {
      getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
      const { errors } = await render()
      expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
    })

    it('does not promise drafts or posting', async () => {
      const { html } = await render()
      expect(html).toContain('Drafts (coming soon)')
      expect(html).toContain('Shipnote never posts')
      expect(html).not.toMatch(/Generate post|Schedule|Archive|Duplicate/i)
    })
  })

  describe('the tabs', () => {
    it('are real links that change the page, with the current one marked', async () => {
      const { html } = await render()
      expect(html).toContain('aria-label="Sections of this project"')
      expect(html).toContain(`href="${PATH}?tab=overview"`)
      expect(html).toContain(`href="${PATH}?tab=github"`)
      expect(html).toContain(`href="${PATH}?tab=notes"`)
      expect(html).not.toContain('href="#github"')
      expect(html).not.toContain('href="#notes"')
    })

    it.each([
      ['overview', 'Overview'],
      ['github', 'GitHub'],
      ['notes', 'Notes'],
    ])('marks only %s as current on its own tab', async (tab, label) => {
      const { html } = await render({ tab })
      const current = [
        ...html.matchAll(
          /aria-current="page"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)</g,
        ),
      ]
      expect(current.map((m) => m[1])).toEqual([label])
    })

    it('opens on Overview by default', async () => {
      const { html } = await render()
      expect(html).toContain(OVERVIEW)
      expect(html).not.toContain(GITHUB)
      expect(html).not.toContain(NOTES)
    })

    it('the Overview tab shows the status cards and the progress panel only', async () => {
      const { html } = await render({ tab: 'overview' })
      expect(html).toContain('GitHub connection')
      expect(html).toContain('Project stage')
      expect(html).toContain(OVERVIEW)
      expect(html).not.toContain(GITHUB)
      expect(html).not.toContain(NOTES)
      expect(html).not.toContain('line one')
    })

    it('the GitHub tab shows the GitHub card only', async () => {
      const { html } = await render({ tab: 'github' })
      expect(html).toContain(GITHUB)
      expect(html).toContain('Linked repository')
      expect(html).toContain('Unlink repository')
      expect(html).not.toContain(OVERVIEW)
      expect(html).not.toContain(NOTES)
      expect(html).not.toContain('line one')
    })

    it('the Notes tab shows the notes only', async () => {
      const { html } = await render({ tab: 'notes' })
      expect(html).toContain(NOTES)
      expect(html).toContain('line one\nline two')
      expect(html).not.toContain(OVERVIEW)
      expect(html).not.toContain(GITHUB)
    })

    it('Notes says so when there are none', async () => {
      getProject.mockResolvedValue({ ok: true, value: project({ notes: '' }) })
      const { html } = await render({ tab: 'notes' })
      expect(html).toContain('No notes yet')
    })

    it('the details column says so when there is no summary', async () => {
      getProject.mockResolvedValue({
        ok: true,
        value: project({ summary: null }),
      })
      const { html } = await render()
      expect(html).toContain('No summary')
    })

    it.each([
      '',
      'GITHUB',
      'settings',
      'posts',
      '<script>alert(1)</script>',
      '../../etc',
      '__proto__',
    ])(
      'an unknown tab (%s) opens Overview and is never echoed',
      async (tab) => {
        const { html } = await render({ tab })
        expect(html).toContain(OVERVIEW)
        expect(html).not.toContain('<script>alert')
        expect(html).not.toContain('../../etc')
      },
    )

    it('the Manage button on the connection card opens the GitHub tab', async () => {
      const { html } = await render({ tab: 'overview' })
      expect(html).toContain(`href="${PATH}?tab=github"`)
      expect(html).toContain('Manage')
    })
  })

  describe('plain text', () => {
    it('renders the name, summary and notes as text, never as markup', async () => {
      getProject.mockResolvedValue({
        ok: true,
        value: project({
          name: '<img src=x onerror=alert(1)>',
          summary: '<script>alert(1)</script>',
          notes: '<b>bold</b><script>alert(2)</script>',
        }),
      })
      for (const tab of ['overview', 'notes']) {
        const { html } = await render({ tab })
        expect(html).not.toContain('<img src=x')
        expect(html).not.toContain('<script>alert')
        expect(html).not.toContain('<b>bold')
      }
      const { html } = await render({ tab: 'notes' })
      expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    })
  })

  describe('with GitHub on', () => {
    it('shows the GitHub tab, and the repository choice for an unlinked project', async () => {
      getProject.mockResolvedValue({ ok: true, value: project() })
      const overview = await render()
      expect(overview.html).toContain('No repository linked')
      const github = await render({ tab: 'github' })
      expect(github.html).toContain('Choose a repository')
      expect(github.html).not.toContain('View on GitHub')
    })

    it('a linked project shows Connected, the repository and a link to it', async () => {
      const { html } = await render()
      expect(html).toContain('Connected')
      expect(html).toContain('octo/hello')
      expect(html).toContain('href="https://github.com/octo/hello"')
      expect(html).toMatch(/rel="noreferrer noopener"/)
      expect(html).toContain('Change repository')
    })

    it('a project that lost its installation shows Needs reconnect and Reconnect', async () => {
      getProject.mockResolvedValue({
        ok: true,
        value: project({ repoFullName: 'octo/hello', installationId: null }),
      })
      expect((await render()).html).toContain('Needs reconnect')
      expect((await render({ tab: 'github' })).html).toContain(
        'Reconnect GitHub',
      )
    })

    it('a GitHub message with no tab opens the GitHub tab, as fixed text', async () => {
      const { html } = await render({ github: 'connected' })
      expect(html).toContain('GitHub connected')
      expect(html).toContain(GITHUB)
      expect(html).not.toContain(OVERVIEW)
    })

    it('an explicit tab wins over the message', async () => {
      const { html } = await render({ github: 'connected', tab: 'notes' })
      expect(html).toContain('GitHub connected')
      expect(html).toContain(NOTES)
      expect(html).not.toContain(GITHUB)
    })

    it('ignores any other message value and never echoes it', async () => {
      const { html } = await render({ github: '<script>alert(1)</script>' })
      expect(html).not.toContain('<script>alert')
      expect(html).toContain(OVERVIEW)
    })
  })

  describe('with GitHub off', () => {
    beforeEach(() => {
      githubIsEnabled.mockReturnValue(false)
    })

    it('has no GitHub tab, card, link or message anywhere', async () => {
      const searches: Record<string, string>[] = [
        {},
        { tab: 'overview' },
        { tab: 'notes' },
        { tab: 'github' },
        { github: 'connected' },
      ]
      for (const search of searches) {
        const { html } = await render(search)
        expect(html).not.toMatch(/GitHub/i)
        expect(html).not.toContain('github.com')
        expect(html).not.toContain('tab=github')
      }
      expect(listInstallations).not.toHaveBeenCalled()
    })

    it('?tab=github opens Overview instead', async () => {
      const { html } = await render({ tab: 'github' })
      expect(html).toContain(OVERVIEW)
      expect(html).not.toContain(GITHUB)
    })

    it('still has the Overview and Notes tabs', async () => {
      const { html } = await render()
      expect(html).toContain(`href="${PATH}?tab=overview"`)
      expect(html).toContain(`href="${PATH}?tab=notes"`)
      expect(html).toContain('Project stage')
    })
  })
})
