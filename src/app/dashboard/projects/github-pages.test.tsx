import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Renders the GitHub card and the repository picker with the data layer mocked.

const requireUser = vi.fn()
const githubIsEnabled = vi.fn()
const listInstallations = vi.fn()
const listRepoChoices = vi.fn()
const getProject = vi.fn()
const rateLimit = vi.fn()
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  notFound,
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/github-app', () => ({ githubIsEnabled }))
vi.mock('@/server/github-projects', () => ({
  listInstallations,
  listRepoChoices,
}))
vi.mock('@/server/projects', () => ({ getProject }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('../github/actions', () => ({ connectGithubAction: vi.fn() }))
vi.mock('./github-actions', () => ({
  linkRepoAction: vi.fn(),
  unlinkRepoAction: vi.fn(),
  disconnectGithubAction: vi.fn(),
  checkCommitsAction: vi.fn(),
}))

const { GithubPanel } = await import('./github-panel')
const { default: ChooseRepoPage } = await import('./[id]/repo/page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'

const project = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Shipnote',
  summary: null,
  stage: 'in_progress',
  notes: '',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-27T11:00:00Z',
  repoFullName: null,
  installationId: null,
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
  const html = (await new Response(stream).text()).replaceAll('<!-- -->', '')
  return { html, errors }
}

const panel = (
  p: ReturnType<typeof project>,
  flash: Parameters<typeof GithubPanel>[0]['flash'] = null,
) => render(<GithubPanel userId={USER} project={p as never} flash={flash} />)

describe('GithubPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    githubIsEnabled.mockReturnValue(true)
    listInstallations.mockResolvedValue([])
  })

  it('renders nothing at all while the feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    const { html } = await panel(project())
    expect(html).toBe('')
    expect(listInstallations).not.toHaveBeenCalled()
  })

  it('offers Connect GitHub, and says what is requested and stored', async () => {
    const { html } = await panel(project())
    expect(html).toContain('Connect GitHub')
    expect(html).toContain('read-only')
    expect(html).toContain('stores no code or commits')
    expect(html).not.toContain('Check for [post] commits')
  })

  it('offers Reconnect GitHub when a repo is linked but no installation exists', async () => {
    const { html } = await panel(project({ repoFullName: 'octo/hello' }))
    expect(html).toContain('Reconnect GitHub')
    expect(html).toContain('octo/hello')
    expect(html).toContain('Unlink repository')
  })

  it('offers to choose a repository once GitHub is connected', async () => {
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
    ])
    const { html } = await panel(project())
    expect(html).toContain('Choose a repository')
    expect(html).toContain(`href="/dashboard/projects/${ID}/repo"`)
    expect(html).toContain('Disconnect GitHub')
    expect(html).not.toContain('Check for [post] commits')
  })

  it('shows the check button, repo name and controls for a linked project', async () => {
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
    ])
    const { html } = await panel(
      project({ repoFullName: 'octo/hello', installationId: 42 }),
    )
    expect(html).toContain('octo/hello')
    expect(html).toContain('Check for [post] commits')
    expect(html).toContain('Change repository')
    expect(html).toContain('Unlink repository')
    expect(html).toContain('Disconnect GitHub')
  })

  it('shows Reconnect (and no check button) when the project lost its installation', async () => {
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
    ])
    const { html } = await panel(
      project({ repoFullName: 'octo/hello', installationId: null }),
    )
    expect(html).toContain('Reconnect GitHub')
    expect(html).toContain('GitHub access for it was removed')
    expect(html).not.toContain('Check for [post] commits')
  })

  it('says so, plainly, when the connection cannot be read', async () => {
    listInstallations.mockResolvedValue(null)
    const { html } = await panel(project())
    expect(html).toContain('We could not load your GitHub connection')
  })

  it('shows fixed wording for a flash code', async () => {
    const { html } = await panel(project(), 'org')
    expect(html).toContain('Organization installations are not supported yet')
  })

  it('the disconnect note says it does not uninstall the app', async () => {
    listInstallations.mockResolvedValue([
      { installationId: 42, accountLogin: 'octo' },
    ])
    const { html } = await panel(
      project({ repoFullName: 'octo/hello', installationId: 42 }),
    )
    // The confirm text appears after the first click; the button is the entry point.
    expect(html).toContain('Disconnect GitHub')
  })
})

describe('ChooseRepoPage', () => {
  const page = () =>
    render(
      <ChooseRepoPage
        params={Promise.resolve({ id: ID })}
        searchParams={Promise.resolve({})}
      />,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    githubIsEnabled.mockReturnValue(true)
    rateLimit.mockResolvedValue(true)
    getProject.mockResolvedValue({ ok: true, value: project() })
    listRepoChoices.mockResolvedValue({
      status: 'ok',
      groups: [
        {
          installationId: 42,
          accountLogin: 'octo',
          repos: ['octo/hello', 'octo/other'],
        },
      ],
    })
  })

  it('lists only the repositories GitHub returned, as installation|repo values', async () => {
    const { html } = await page()
    expect(html).toContain('value="42|octo/hello"')
    expect(html).toContain('value="42|octo/other"')
    expect(html).toContain('Link repository')
    expect(listRepoChoices).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('renders a hostile repository name as text, not markup', async () => {
    listRepoChoices.mockResolvedValue({
      status: 'ok',
      groups: [
        {
          installationId: 42,
          accountLogin: '<b>x</b>',
          repos: ['octo/<img src=x>'],
        },
      ],
    })
    const { html } = await page()
    expect(html).not.toContain('<img src=x>')
    expect(html).not.toContain('<b>x</b>')
  })

  it('is a 404 while the feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    const { errors } = await page()
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
    expect(listRepoChoices).not.toHaveBeenCalled()
  })

  it('a project that is not the user’s is a 404, and GitHub is never asked', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    const { errors } = await page()
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
    expect(listRepoChoices).not.toHaveBeenCalled()
  })

  it('asks the person to connect when there is no installation', async () => {
    listRepoChoices.mockResolvedValue({ status: 'none' })
    const { html } = await page()
    expect(html).toContain('GitHub is not connected')
    expect(html).toContain('Connect GitHub')
  })

  it.each([
    ['rate_limited', 'limiting requests'],
    ['unavailable', 'not responding'],
    ['failed', 'could not load your repositories'],
  ])('shows plain wording for a GitHub %s', async (kind, words) => {
    listRepoChoices.mockResolvedValue({ status: 'error', kind })
    const { html } = await page()
    expect(html).toContain(words)
  })

  it('is rate limited before asking GitHub', async () => {
    rateLimit.mockResolvedValue(false)
    const { html } = await page()
    expect(html).toContain('Too many attempts')
    expect(listRepoChoices).not.toHaveBeenCalled()
  })

  it('says so when an installation can see no repositories', async () => {
    listRepoChoices.mockResolvedValue({
      status: 'ok',
      groups: [{ installationId: 42, accountLogin: 'octo', repos: [] }],
    })
    const { html } = await page()
    expect(html).toContain('cannot see any repositories')
  })
})
