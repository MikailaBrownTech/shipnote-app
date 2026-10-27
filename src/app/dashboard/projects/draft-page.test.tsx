import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Drafts tab on the project page, with AI on and off. Rendered on the
// server, so this checks what is on the page; clicking is checked by hand.

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const getProject = vi.fn()
const aiIsEnabled = vi.fn()
const draftsLeftToday = vi.fn()
const listRecentDrafts = vi.fn()
const coveredShas = vi.fn()

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
vi.mock('@/server/github-projects', () => ({ listInstallations: vi.fn() }))
vi.mock('@/server/projects', () => ({ getProject }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled, draftsLeftToday }))
vi.mock('@/server/drafts', () => ({ listRecentDrafts, coveredShas }))
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
vi.mock('./draft-actions', () => ({
  generateDraftAction: vi.fn(),
  saveDraftAction: vi.fn(),
  copyDraftAction: vi.fn(),
  discardDraftAction: vi.fn(),
}))

const { default: ProjectPage } = await import('./[id]/page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const PATH = `/dashboard/projects/${ID}`

const project = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Proposal Generator',
  summary: null,
  stage: 'in_progress',
  notes: '',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-27T11:00:00Z',
  repoFullName: 'octo/hello',
  installationId: 42,
  ...over,
})

const draft = (over: Record<string, unknown> = {}) => ({
  id: '99999999-2222-4333-8444-555555555555',
  projectId: ID,
  body: 'A plain draft',
  status: 'draft',
  model: 'claude-sonnet-5-5',
  createdAt: '2026-10-27T09:30:00Z',
  copiedAt: null,
  shas: [],
  ...over,
})

async function render(search: Record<string, string> = { tab: 'drafts' }) {
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

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  githubIsEnabled.mockReturnValue(true)
  aiIsEnabled.mockReturnValue(true)
  draftsLeftToday.mockResolvedValue(7)
  listRecentDrafts.mockResolvedValue([])
  coveredShas.mockResolvedValue([])
  getProject.mockResolvedValue({ ok: true, value: project() })
})

describe('with AI on', () => {
  it('has a Drafts tab, marked current on its own page', async () => {
    const { html } = await render()
    expect(html).toContain(`href="${PATH}?tab=drafts"`)
    const current = [
      ...html.matchAll(/aria-current="page"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)</g),
    ]
    expect(current.map((m) => m[1])).toEqual(['Drafts'])
  })

  it('shows the note box, the Generate button and the drafts left', async () => {
    const { html, errors } = await render()
    expect(errors).toEqual([])
    expect(html).toContain('Write a draft')
    expect(html).toContain('Generate draft')
    expect(html).toContain('7 of 10 drafts left today')
    expect(html).toContain('Note for this post')
    expect(html).toContain('maxLength="500"')
  })

  it('says that Generate again uses another draft, and that it never posts', async () => {
    const { html } = await render()
    expect(html).toContain(
      'Pressing Generate again writes a new draft and uses another of today’s drafts.',
    )
    expect(html).toContain('Shipnote never posts')
    expect(html).not.toMatch(/Schedule|Post now|Publish/i)
  })

  it('offers to check commits when a repository is linked', async () => {
    const { html } = await render()
    expect(html).toContain('Check for [post] commits')
  })

  it('works from a note alone when no repository is linked', async () => {
    getProject.mockResolvedValue({
      ok: true,
      value: project({ repoFullName: null, installationId: null }),
    })
    const { html } = await render()
    expect(html).not.toContain('Check for [post] commits')
    expect(html).toContain('write from a note alone')
    expect(html).toContain('Generate draft')
  })

  it('works with GitHub off', async () => {
    githubIsEnabled.mockReturnValue(false)
    getProject.mockResolvedValue({
      ok: true,
      value: project({ repoFullName: null, installationId: null }),
    })
    const { html } = await render()
    expect(html).toContain('Generate draft')
    expect(html).not.toContain('href="' + PATH + '?tab=github"')
  })

  it('disables Generate when none are left', async () => {
    draftsLeftToday.mockResolvedValue(0)
    const { html } = await render()
    expect(html).toContain('0 of 10 drafts left today')
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Generate draft/,
    )
  })

  it('still shows the form when the count cannot be read', async () => {
    draftsLeftToday.mockResolvedValue(null)
    const { html } = await render()
    expect(html).toContain('10 drafts a day')
    expect(html).toContain('Generate draft')
  })

  it('lists recent drafts, with a Copied tag, as text in an editable box', async () => {
    listRecentDrafts.mockResolvedValue([
      draft(),
      draft({
        id: '88888888-2222-4333-8444-555555555555',
        body: 'Another one',
        status: 'copied',
      }),
    ])
    const { html } = await render()
    expect(html).toContain('Recent drafts')
    expect(html).toContain('Draft from Oct 27, 2026')
    expect(html).toContain('>A plain draft</textarea>')
    expect(html).toContain('>Another one</textarea>')
    expect(html).toContain('Copied')
    expect(html).toContain('Discard')
    expect(html).toContain('Save changes')
    expect(html).toMatch(/\d+ words?</)
  })

  it('shows a draft’s markup as text, never as HTML', async () => {
    listRecentDrafts.mockResolvedValue([
      draft({ body: '<img src=x onerror=alert(1)><script>x()</script>' }),
    ])
    const { html } = await render()
    expect(html).not.toContain('<script>x()')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('says so plainly when the drafts cannot be loaded', async () => {
    listRecentDrafts.mockResolvedValue(null)
    const { html } = await render()
    expect(html).toContain('We could not load your drafts.')
    expect(html).not.toContain('Generate draft')
  })

  it('asks for the drafts of this user and this project only', async () => {
    await render()
    expect(listRecentDrafts).toHaveBeenCalledWith(USER, ID, 10)
    expect(coveredShas).toHaveBeenCalledWith(USER, ID)
    expect(draftsLeftToday).toHaveBeenCalledWith(USER)
  })

  it('the Overview points to the Drafts tab', async () => {
    const { html } = await render({ tab: 'overview' })
    expect(html).not.toContain('coming soon')
    expect(html).toContain('Open the Drafts tab')
    expect(listRecentDrafts).not.toHaveBeenCalled()
  })
})

describe('with AI off', () => {
  beforeEach(() => {
    aiIsEnabled.mockReturnValue(false)
  })

  it('has no Drafts tab and shows no generation controls', async () => {
    const { html } = await render({ tab: 'overview' })
    expect(html).not.toContain('tab=drafts')
    expect(html).not.toContain('Generate draft')
    expect(html).toContain('Drafts (coming soon)')
  })

  it('?tab=drafts opens Overview and loads nothing', async () => {
    const { html } = await render({ tab: 'drafts' })
    expect(html).toContain('Turn your progress into LinkedIn content')
    expect(html).not.toContain('Generate draft')
    expect(listRecentDrafts).not.toHaveBeenCalled()
    expect(coveredShas).not.toHaveBeenCalled()
    expect(draftsLeftToday).not.toHaveBeenCalled()
  })
})
