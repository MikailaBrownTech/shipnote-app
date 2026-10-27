import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Renders the real pages (server components, client forms and all) with the
// session and the data layer mocked, and checks the output.

const requireUser = vi.fn()
const listProjects = vi.fn()
const getProject = vi.fn()
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('server-only', () => ({}))
// Scheduling is off in these tests, as it is by default.
vi.mock('@/server/scheduling', () => ({ schedulingIsEnabled: () => false }))
vi.mock('@/server/scheduled-posts', () => ({
  getConnectionStatus: vi.fn(),
  listProjectSchedules: vi.fn(),
}))
vi.mock('../buffer/actions', () => ({
  connectBufferAction: vi.fn(),
  disconnectBufferAction: vi.fn(),
  startReviewAction: vi.fn(),
  confirmScheduleAction: vi.fn(),
  cancelScheduleAction: vi.fn(),
  refreshStatusAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  notFound,
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/projects', () => ({ listProjects, getProject }))
vi.mock('@/app/dashboard/account-menu', () => ({ AccountMenu: () => null }))
// GitHub is off in these tests, as it is by default.
vi.mock('@/server/github-app', () => ({ githubIsEnabled: () => false }))
vi.mock('@/server/github-projects', () => ({ listInstallations: vi.fn() }))
vi.mock('@/server/github-import', () => ({
  listStartRepos: vi.fn(),
  prefillFromRepo: vi.fn(),
  verifyRepoForLink: vi.fn(),
  linkCreatedProject: vi.fn(),
}))
vi.mock('@/server/rate-limit', () => ({ rateLimit: vi.fn() }))
// AI is off in these tests, as it is by default.
vi.mock('@/server/draft-generation', () => ({
  aiIsEnabled: () => false,
  draftsLeftToday: vi.fn(),
}))
vi.mock('@/server/drafts', () => ({
  listRecentDrafts: vi.fn(),
  coveredShas: vi.fn(),
}))
vi.mock('./draft-actions', () => ({
  generateDraftAction: vi.fn(),
  saveDraftAction: vi.fn(),
  copyDraftAction: vi.fn(),
  discardDraftAction: vi.fn(),
}))
vi.mock('../github/actions', () => ({
  connectGithubAction: vi.fn(),
  disconnectGithubFromDashboardAction: vi.fn(),
}))
vi.mock('./github-actions', () => ({
  linkRepoAction: vi.fn(),
  unlinkRepoAction: vi.fn(),
  disconnectGithubAction: vi.fn(),
  checkCommitsAction: vi.fn(),
}))
vi.mock('./actions', () => ({
  createProjectAction: vi.fn(),
  updateProjectAction: vi.fn(),
  deleteProjectAction: vi.fn(),
}))

const { default: DashboardPage } = await import('../page')
const { default: NewProjectPage } = await import('./new/page')
const { default: ProjectPage } = await import('./[id]/page')
const { default: EditProjectPage } = await import('./[id]/edit/page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'

const project = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Shipnote',
  summary: 'Posts from commits',
  stage: 'in_progress',
  notes: 'line one\nline two',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-27T11:00:00Z',
  ...over,
})

async function render(element: ReactElement) {
  const errors: unknown[] = []
  const stream = await renderToReadableStream(element, {
    onError: (error) => {
      errors.push(error)
    },
  })
  await stream.allReady
  // React puts a comment between adjacent text nodes. Drop them to read plain text.
  const html = (await new Response(stream).text()).replaceAll('<!-- -->', '')
  return { html, errors }
}

// The page props Next passes, reduced to what these pages read.
const dashboardProps = {
  params: Promise.resolve({}),
  searchParams: Promise.resolve({}),
}

const idParams = (id: string, tab?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(tab ? { tab } : {}),
})

describe('dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  })

  it('shows the empty state with a New project button', async () => {
    listProjects.mockResolvedValue({ ok: true, value: [] })
    const { html } = await render(<DashboardPage {...dashboardProps} />)
    expect(html).toContain('No projects yet')
    expect(html).toContain('href="/dashboard/projects/new"')
  })

  it('lists projects with name, stage and last updated', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [
        project(),
        project({ id: 'x', name: 'Second', stage: 'shipped' }),
      ],
    })
    const { html } = await render(<DashboardPage {...dashboardProps} />)
    expect(html).toContain('Shipnote')
    expect(html).toContain('Second')
    expect(html).toContain('In progress')
    expect(html).toContain('Shipped')
    expect(html).toContain('Oct 27, 2026')
    expect(html).toContain(`href="/dashboard/projects/${ID}"`)
    expect(html).toContain('2 of 5')
  })

  it('at the cap, shows the limit and no New project button', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [1, 2, 3, 4, 5].map((n) =>
        project({ id: `0000000${String(n)}-2222-4333-8444-555555555555` }),
      ),
    })
    const { html } = await render(<DashboardPage {...dashboardProps} />)
    expect(html).toContain('You have reached the 5 project limit')
    expect(html).not.toContain('href="/dashboard/projects/new"')
  })

  it('says so, without detail, when projects cannot be loaded', async () => {
    listProjects.mockResolvedValue({ ok: false, reason: 'failed' })
    const { html } = await render(<DashboardPage {...dashboardProps} />)
    expect(html).toContain('We could not load your projects')
  })

  it('renders project text as plain text, never as markup', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [project({ name: '<img src=x onerror=alert(1)>' })],
    })
    const { html } = await render(<DashboardPage {...dashboardProps} />)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('redirects a signed-out visitor to sign-in instead of reading projects', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    const { errors } = await render(<DashboardPage {...dashboardProps} />)
    expect(listProjects).not.toHaveBeenCalled()
    expect(String(errors[0])).toContain('redirect:/sign-in')
  })
})

describe('new project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    listProjects.mockResolvedValue({ ok: true, value: [] })
  })

  it('shows the form with the help text and a notes counter', async () => {
    const { html } = await render(<NewProjectPage {...dashboardProps} />)
    expect(html).toContain('Paste your README, spec or recent progress notes')
    expect(html).toContain('Do not paste secrets or customer data')
    expect(html).toContain('0 / 12,000')
    for (const label of ['Project name', 'Summary', 'Stage', 'Notes']) {
      expect(html).toContain(label)
    }
  })

  it('at the cap, shows the limit instead of the form', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [1, 2, 3, 4, 5].map((n) => project({ id: String(n) })),
    })
    const { html } = await render(<NewProjectPage {...dashboardProps} />)
    expect(html).toContain('You have reached the 5 project limit')
    expect(html).not.toContain('name="notes"')
  })
})

describe('project page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  })

  it('shows the project, with edit and delete', async () => {
    getProject.mockResolvedValue({ ok: true, value: project() })
    const { html } = await render(<ProjectPage {...idParams(ID, 'notes')} />)
    expect(html).toContain('Shipnote')
    expect(html).toContain('Posts from commits')
    expect(html).toContain('line one\nline two')
    expect(html).toContain(`href="/dashboard/projects/${ID}/edit"`)
    expect(html).toContain('Delete project')
    expect(getProject).toHaveBeenCalledExactlyOnceWith(USER, ID)
  })

  it('renders notes as text: markup in them is escaped', async () => {
    getProject.mockResolvedValue({
      ok: true,
      value: project({ notes: '<script>alert(1)</script>' }),
    })
    const { html } = await render(<ProjectPage {...idParams(ID, 'notes')} />)
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('shows no GitHub card or button while the feature is off', async () => {
    getProject.mockResolvedValue({ ok: true, value: project() })
    const { html } = await render(<ProjectPage {...idParams(ID)} />)
    expect(html).not.toMatch(/GitHub/i)
  })

  it('keeps the project name out of the page title', async () => {
    const { metadata } = await import('./[id]/page')
    expect(JSON.stringify(metadata)).not.toContain('Shipnote')
  })

  it('a missing or foreign project gives the not-found page', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    const { errors } = await render(<ProjectPage {...idParams(ID)} />)
    expect(notFound).toHaveBeenCalled()
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
  })

  it('a malformed id gives the not-found page without any query', async () => {
    const { errors } = await render(<ProjectPage {...idParams('not-a-uuid')} />)
    expect(getProject).not.toHaveBeenCalled()
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
  })

  it('a failed load is not mistaken for not-found', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'failed' })
    const { html, errors } = await render(<ProjectPage {...idParams(ID)} />)
    expect(errors).toEqual([])
    expect(html).toContain('We could not load this project')
  })
})

describe('edit page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  })

  it('prefills the form with the saved values', async () => {
    getProject.mockResolvedValue({ ok: true, value: project() })
    const { html } = await render(<EditProjectPage {...idParams(ID)} />)
    expect(html).toContain('value="Shipnote"')
    expect(html).toContain('>Posts from commits</textarea>')
    expect(html).toContain('line one')
    expect(html).toContain('Save changes')
  })

  it('a foreign id gives the not-found page', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    const { errors } = await render(<EditProjectPage {...idParams(ID)} />)
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
  })
})
