import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The GitHub panel on /dashboard, and the message after a connect attempt.

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const listInstallations = vi.fn()
const listProjects = vi.fn()

vi.mock('server-only', () => ({}))
// Scheduling is off in these tests, as it is by default.
vi.mock('@/server/scheduling', () => ({ schedulingIsEnabled: () => false }))
vi.mock('@/server/scheduled-posts', () => ({
  getConnectionStatus: vi.fn(),
  listProjectSchedules: vi.fn(),
}))
vi.mock('./buffer/actions', () => ({
  connectBufferAction: vi.fn(),
  disconnectBufferAction: vi.fn(),
  startReviewAction: vi.fn(),
  confirmScheduleAction: vi.fn(),
  cancelScheduleAction: vi.fn(),
  refreshStatusAction: vi.fn(),
}))
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
vi.mock('@/server/projects', () => ({ listProjects }))
vi.mock('./account-menu', () => ({ AccountMenu: () => null }))
vi.mock('./github/actions', () => ({
  connectGithubAction: vi.fn(),
  disconnectGithubFromDashboardAction: vi.fn(),
}))
vi.mock('./projects/github-actions', () => ({
  linkRepoAction: vi.fn(),
  unlinkRepoAction: vi.fn(),
  disconnectGithubAction: vi.fn(),
  checkCommitsAction: vi.fn(),
}))

const { default: DashboardPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'

async function dashboard(search: Record<string, string> = {}) {
  const element: ReactElement = (
    <DashboardPage
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

describe('the GitHub panel on /dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    githubIsEnabled.mockReturnValue(true)
    listInstallations.mockResolvedValue([])
    listProjects.mockResolvedValue({ ok: true, value: [] })
  })

  it('shows nothing about GitHub while the feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    const { html } = await dashboard({ github: 'connected' })
    expect(html).not.toMatch(/GitHub/)
    expect(listInstallations).not.toHaveBeenCalled()
  })

  describe('not connected', () => {
    it('shows a clear Connect GitHub panel with one plain sentence', async () => {
      const { html } = await dashboard()
      expect(html).toContain('Connect GitHub')
      expect(html).toContain('read-only access to the repos you choose')
      expect(html).toContain('never posts for you')
      expect(html).not.toContain('Connected as')
      expect(html).not.toContain('Disconnect GitHub')
    })

    it('the button starts the connect flow from the dashboard (no project)', async () => {
      const { html } = await dashboard()
      // No hidden project field: the person comes back to /dashboard.
      expect(html).not.toContain('name="project"')
      expect(html).not.toContain('name="next"')
    })
  })

  describe('connected', () => {
    beforeEach(() => {
      listInstallations.mockResolvedValue([
        { installationId: 42, accountLogin: 'octo' },
      ])
    })

    it('shows who it is connected as, a Disconnect option and a link to the projects', async () => {
      const { html } = await dashboard()
      expect(html).toContain('Connected as <strong>octo</strong>')
      expect(html).toContain('Disconnect GitHub')
      expect(html).toContain('href="/dashboard#projects-title"')
      expect(html).toContain('View your projects')
      expect(html).not.toContain('>Connect GitHub<')
    })

    it('lists every connected account', async () => {
      listInstallations.mockResolvedValue([
        { installationId: 42, accountLogin: 'octo' },
        { installationId: 43, accountLogin: 'cat' },
      ])
      const { html } = await dashboard()
      expect(html).toContain('<strong>octo</strong>')
      expect(html).toContain('<strong>cat</strong>')
    })

    it('renders the account name as plain text', async () => {
      listInstallations.mockResolvedValue([
        { installationId: 42, accountLogin: '<img src=x onerror=alert(1)>' },
      ])
      const { html } = await dashboard()
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    })
  })

  it('says so, plainly, when the connection cannot be read', async () => {
    listInstallations.mockResolvedValue(null)
    const { html } = await dashboard()
    expect(html).toContain('We could not load your GitHub connection')
    expect(html).not.toContain('Connect GitHub')
  })

  describe('the message after a connect attempt', () => {
    it('shows "GitHub connected" after a success', async () => {
      const { html } = await dashboard({ github: 'connected' })
      expect(html).toContain('GitHub connected')
      expect(html).toContain('role="status"')
    })

    it.each([
      ['expired', 'expired'],
      ['invalid', 'could not confirm'],
      ['denied', 'did not give us access'],
      ['org', 'Organization installations are not supported yet'],
      ['taken', 'already connected to another Shipnote account'],
      ['limited', 'Too many attempts'],
      ['unavailable', 'not responding'],
      ['failed', 'Something went wrong'],
    ])('shows the plain error for %s', async (code, words) => {
      const { html } = await dashboard({ github: code })
      expect(html).toContain(words)
      expect(html).toContain('role="alert"')
    })

    it.each([
      '<script>alert(1)</script>',
      'https://evil.test/',
      'GitHub says your token is ghs_abc',
      'connected ',
      'CONNECTED',
      '',
      '__proto__',
    ])('ignores any other value and never echoes it (%s)', async (value) => {
      const { html } = await dashboard({ github: value })
      expect(html).not.toContain('evil.test')
      expect(html).not.toContain('ghs_abc')
      expect(html).not.toContain('<script>alert')
      expect(html).not.toContain('GitHub connected')
      expect(html).not.toContain('role="alert"')
    })

    it('ignores other parameters entirely', async () => {
      const { html } = await dashboard({
        message: 'Your GitHub token is ghs_abc',
        error: 'boom',
      })
      expect(html).not.toContain('ghs_abc')
      expect(html).not.toContain('boom')
    })

    it('a disconnect shows its confirmation', async () => {
      const { html } = await dashboard({ github: 'disconnected' })
      expect(html).toContain('GitHub disconnected from Shipnote')
      expect(html).toContain('still installed on GitHub')
    })
  })

  it('still requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    const { errors } = await dashboard()
    expect(String(errors[0])).toContain('redirect:/sign-in')
    expect(listInstallations).not.toHaveBeenCalled()
  })
})
