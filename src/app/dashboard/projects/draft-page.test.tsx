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
const schedulingIsEnabled = vi.fn()
const autoDraftsOn = vi.fn()
const readAutoDraft = vi.fn()
const listAutoJobs = vi.fn()
const getConnectionStatus = vi.fn()
const listProjectSchedules = vi.fn()

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
vi.mock('@/server/scheduling', () => ({ schedulingIsEnabled }))
vi.mock('@/server/auto-drafts', () => ({
  autoDraftsOn,
  readAutoDraft,
  listAutoJobs,
  setAutoDraft: vi.fn(),
}))
vi.mock('./auto-draft-actions', () => ({ setAutoDraftAction: vi.fn() }))
vi.mock('@/server/scheduled-posts', () => ({
  getConnectionStatus,
  listProjectSchedules,
}))
vi.mock('../buffer/actions', () => ({
  connectBufferAction: vi.fn(),
  disconnectBufferAction: vi.fn(),
  startReviewAction: vi.fn(),
  confirmScheduleAction: vi.fn(),
  cancelScheduleAction: vi.fn(),
  refreshStatusAction: vi.fn(),
}))
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
  schedulingIsEnabled.mockReturnValue(false)
  autoDraftsOn.mockReturnValue(false)
  readAutoDraft.mockResolvedValue(false)
  listAutoJobs.mockResolvedValue([])
  getConnectionStatus.mockResolvedValue({ state: 'none', connectedAt: null })
  listProjectSchedules.mockResolvedValue([])
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

describe('with scheduling on', () => {
  const when = '2026-11-10T14:30:00.000Z'
  const DRAFT_ID = '99999999-2222-4333-8444-555555555555'
  const schedule = (over: Record<string, unknown> = {}) => ({
    id: '77777777-2222-4333-8444-555555555555',
    projectId: ID,
    draftId: DRAFT_ID,
    body: 'The exact text that was sent',
    channelLabel: 'My LinkedIn',
    scheduledFor: when,
    bufferPostId: 'bp-1',
    status: 'scheduled',
    failureCode: null,
    createdAt: '2026-11-02T12:00:00Z',
    ...over,
  })
  const connected = () =>
    getConnectionStatus.mockResolvedValue({
      state: 'connected',
      connectedAt: 'x',
    })

  beforeEach(() => {
    schedulingIsEnabled.mockReturnValue(true)
    listRecentDrafts.mockResolvedValue([draft()])
  })

  it('offers Connect Buffer on a draft when not connected, and no scheduling', async () => {
    getConnectionStatus.mockResolvedValue({ state: 'none', connectedAt: null })
    const { html, errors } = await render()
    expect(errors).toEqual([])
    expect(html).toContain(
      'Connect your Buffer account to schedule this draft on LinkedIn.',
    )
    expect(html).toContain('Connect Buffer')
    expect(html).not.toContain('Schedule on LinkedIn')
  })

  it('remembers the project and draft in the Connect button so the person comes back', async () => {
    getConnectionStatus.mockResolvedValue({ state: 'none', connectedAt: null })
    const { html } = await render()
    expect(html).toContain(`name="project" value="${ID}"`)
    expect(html).toContain(`name="draft" value="${DRAFT_ID}"`)
  })

  it('offers Schedule on LinkedIn when connected, and schedules nothing by itself', async () => {
    connected()
    const { html } = await render()
    expect(html).toContain('Schedule on LinkedIn')
    expect(html).not.toContain('Confirm and schedule')
    expect(html).not.toContain('Review before scheduling')
  })

  it('offers Reconnect Buffer when it needs it', async () => {
    getConnectionStatus.mockResolvedValue({
      state: 'needs_reconnect',
      connectedAt: 'x',
    })
    const { html } = await render()
    expect(html).toContain('Reconnect Buffer')
    expect(html).toContain(
      'Buffer needs to be connected again to schedule posts.',
    )
    expect(html).not.toContain('Schedule on LinkedIn')
  })

  it('shows an active schedule with Cancel, and says edits do not change it', async () => {
    connected()
    listProjectSchedules.mockResolvedValue([schedule()])
    const { html } = await render()
    expect(html).toContain('Scheduled for Nov 10, 2026, 2:30 PM UTC')
    expect(html).toContain('on My LinkedIn')
    expect(html).toContain(
      'Editing this draft later does not change the scheduled text.',
    )
    expect(html).toContain('Cancel schedule')
    expect(html).not.toContain('Schedule on LinkedIn')
  })

  it('shows a published post without a cancel button', async () => {
    connected()
    listProjectSchedules.mockResolvedValue([schedule({ status: 'published' })])
    const { html } = await render()
    expect(html).toContain('Published by Buffer')
    expect(html).not.toContain('Cancel schedule')
  })

  it('a canceled or failed schedule leaves the draft free to schedule again', async () => {
    connected()
    listProjectSchedules.mockResolvedValue([
      schedule({ status: 'canceled' }),
      schedule({
        id: '88888888-2222-4333-8444-555555555555',
        status: 'failed',
        failureCode: 'unknown_result',
      }),
    ])
    const { html } = await render()
    expect(html).toContain('Schedule on LinkedIn')
  })

  it('lists the project schedules as plain text with a Refresh status button', async () => {
    connected()
    listProjectSchedules.mockResolvedValue([
      schedule({ body: '<img src=x onerror=alert(1)> and **bold**' }),
      schedule({
        id: '88888888-2222-4333-8444-555555555555',
        draftId: null,
        status: 'failed',
        failureCode: 'unknown_result',
      }),
    ])
    const { html } = await render()
    expect(html).toContain('Scheduled posts')
    expect(html).toContain('Refresh status')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; and **bold**')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain(
      'We could not confirm whether Buffer scheduled this. Check Buffer.',
    )
  })

  it('says so when nothing is scheduled', async () => {
    connected()
    const { html } = await render()
    expect(html).toContain('Nothing scheduled for this project yet.')
  })

  it('asks only for this user and this project schedules', async () => {
    connected()
    await render()
    expect(listProjectSchedules).toHaveBeenCalledWith(USER, ID, 20)
  })

  it('offers no scheduling when the connection cannot be read', async () => {
    getConnectionStatus.mockResolvedValue(null)
    const { html } = await render()
    expect(html).not.toContain('Schedule on LinkedIn')
    expect(html).not.toContain('Connect Buffer')
    expect(html).not.toContain('Scheduled posts')
  })

  it('never offers to post, send or publish by itself', async () => {
    connected()
    const { html } = await render()
    expect(html).not.toMatch(
      /Post now|Publish now|Auto-?schedule|Schedule automatically/i,
    )
  })
})

describe('with scheduling off', () => {
  it('shows no Buffer text, controls or scheduled posts, and reads nothing from Buffer', async () => {
    schedulingIsEnabled.mockReturnValue(false)
    listRecentDrafts.mockResolvedValue([draft()])
    const { html } = await render()
    expect(html).not.toMatch(/Buffer|Schedule on LinkedIn|Scheduled posts/)
    expect(getConnectionStatus).not.toHaveBeenCalled()
    expect(listProjectSchedules).not.toHaveBeenCalled()
  })
})

describe('with automatic drafts on', () => {
  const SHA_A = 'a1b2c3d4'.padEnd(40, 'e')
  const job = (over: Record<string, unknown> = {}) => ({
    id: 'job-1',
    commitSha: SHA_A,
    status: 'skipped',
    reason: 'daily_limit',
    draftId: null,
    createdAt: '2026-11-03T10:00:00Z',
    ...over,
  })

  beforeEach(() => {
    autoDraftsOn.mockReturnValue(true)
    readAutoDraft.mockResolvedValue(false)
    listAutoJobs.mockResolvedValue([])
  })

  it('shows the switch, off, with a plain explanation', async () => {
    const { html, errors } = await render()
    expect(errors).toEqual([])
    expect(html).toContain('Automatic drafts')
    expect(html).toContain('Draft automatically when I push a commit with')
    expect(html).toContain('Off by default.')
    expect(html).toContain('Only the commit message is used')
    expect(html).toContain('uses one of your 10 drafts for the day')
    expect(html).toContain('automatic drafts are tagged Auto')
    expect(html).toContain('Turn on automatic drafts')
    expect(html).not.toContain('Turn off automatic drafts')
  })

  it('offers to turn it off when it is on', async () => {
    readAutoDraft.mockResolvedValue(true)
    const { html } = await render()
    expect(html).toContain('Turn off automatic drafts')
    expect(html).not.toContain('Turn on automatic drafts')
  })

  it('cannot be turned on without a linked repository, and says why', async () => {
    getProject.mockResolvedValue({
      ok: true,
      value: project({ repoFullName: null, installationId: null }),
    })
    const { html } = await render()
    expect(html).toContain(
      'Link a repository on the GitHub tab to turn this on.',
    )
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Turn on automatic drafts/,
    )
  })

  it('lists skipped and failed commits with a short sha and a plain reason', async () => {
    listAutoJobs.mockResolvedValue([
      job(),
      job({
        id: 'job-2',
        commitSha: 'f'.repeat(40),
        status: 'failed',
        reason: 'commit_not_found',
      }),
      job({
        id: 'job-3',
        commitSha: '1'.repeat(40),
        status: 'done',
        reason: null,
        draftId: 'd',
      }),
      job({
        id: 'job-4',
        commitSha: '2'.repeat(40),
        status: 'queued',
        reason: null,
      }),
    ])
    const { html } = await render()
    expect(html).toContain('Commits that did not make a draft')
    expect(html).toContain('<code>a1b2c3d</code>')
    expect(html).toContain('You had already used your 10 drafts for the day.')
    expect(html).toContain('<code>fffffff</code>')
    expect(html).toContain('GitHub could not find the commit.')
    expect(html).toContain('Skipped')
    expect(html).toContain('Failed')
    expect(html).not.toContain('<code>1111111</code>')
    expect(html).not.toContain('<code>2222222</code>')
  })

  it('shows only a short sha and a fixed reason, never the whole sha', async () => {
    listAutoJobs.mockResolvedValue([job()])
    const { html } = await render()
    expect(html).not.toContain(SHA_A)
  })

  it('an unknown reason code is shown generically, never as given', async () => {
    listAutoJobs.mockResolvedValue([
      job({ reason: '<script>alert(1)</script>' }),
    ])
    const { html } = await render()
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('Something went wrong.')
  })

  it('tags a draft that a push wrote with Auto', async () => {
    listRecentDrafts.mockResolvedValue([
      draft(),
      draft({
        id: '88888888-2222-4333-8444-555555555555',
        body: 'Written by a push',
      }),
    ])
    listAutoJobs.mockResolvedValue([
      job({
        status: 'done',
        reason: null,
        draftId: '88888888-2222-4333-8444-555555555555',
      }),
    ])
    const { html } = await render()
    const tags = [...html.matchAll(/<span class="[^"]*">Auto<\/span>/g)]
    expect(tags.length).toBeGreaterThanOrEqual(1)
    const items = html.split('<li><details>').slice(1)
    expect(items).toHaveLength(2)
    expect(items.filter((item) => item.includes('>Auto</span>'))).toHaveLength(
      1,
    )
  })

  it('asks only for this user and this project', async () => {
    await render()
    expect(readAutoDraft).toHaveBeenCalledWith(USER, ID)
    expect(listAutoJobs).toHaveBeenCalledWith(USER, ID, 20)
  })

  it('shows no card when the switch cannot be read', async () => {
    readAutoDraft.mockResolvedValue(null)
    const { html } = await render()
    expect(html).not.toContain('Automatic drafts')
  })

  it('shows no card when the jobs cannot be read', async () => {
    listAutoJobs.mockResolvedValue(null)
    const { html } = await render()
    expect(html).not.toContain('Automatic drafts')
  })
})

describe('with automatic drafts off', () => {
  it('shows no switch, no card and no Auto tag, and reads nothing', async () => {
    autoDraftsOn.mockReturnValue(false)
    listRecentDrafts.mockResolvedValue([draft()])
    const { html } = await render()
    expect(html).not.toContain('Automatic drafts')
    expect(html).not.toContain('Turn on automatic drafts')
    expect(html).not.toContain('>Auto</span>')
    expect(readAutoDraft).not.toHaveBeenCalled()
    expect(listAutoJobs).not.toHaveBeenCalled()
  })
})
