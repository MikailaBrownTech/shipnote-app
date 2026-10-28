import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Posts page, rendered on the server: what is on the page, in each state.

const requireUser = vi.fn()
const listUserPosts = vi.fn()
const listProjects = vi.fn()
const aiIsEnabled = vi.fn()
const syncDueSchedules = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/posts', () => ({ listUserPosts }))
vi.mock('@/server/projects', () => ({ listProjects }))
vi.mock('@/server/schedule-sync', () => ({ syncDueSchedules }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled }))

const { default: PostsPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const D1 = 'aaaaaaaa-2222-4333-8444-555555555555'
const S1 = 'bbbbbbbb-2222-4333-8444-555555555555'

const draft = (over: Record<string, unknown> = {}) => ({
  id: D1,
  projectId: PROJECT,
  body: 'Just shipped a major update\n\nKey improvements',
  status: 'draft',
  createdAt: '2026-10-27T09:00:00Z',
  ...over,
})

const schedule = (over: Record<string, unknown> = {}) => ({
  id: S1,
  projectId: PROJECT,
  draftId: null,
  body: 'How we reduced incident response time',
  status: 'scheduled',
  scheduledFor: '2026-10-30T10:00:00Z',
  createdAt: '2026-10-27T10:00:00Z',
  ...over,
})

async function render(search: Record<string, string> = {}) {
  const element: ReactElement = (
    <PostsPage
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
  aiIsEnabled.mockReturnValue(true)
  syncDueSchedules.mockResolvedValue(0)
  listProjects.mockResolvedValue({
    ok: true,
    value: [{ id: PROJECT, name: 'Proposal Generator' }],
  })
  listUserPosts.mockResolvedValue({
    drafts: [draft()],
    schedules: [schedule()],
    truncated: false,
  })
})

describe('the Posts page', () => {
  it('asks for the signed-in user’s own posts and projects only', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
    expect(listUserPosts).toHaveBeenCalledExactlyOnceWith(USER)
    expect(listProjects).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('checks due posts with Buffer first, for this user only', async () => {
    await render()
    expect(syncDueSchedules).toHaveBeenCalledExactlyOnceWith(USER)
    expect(syncDueSchedules.mock.invocationCallOrder[0]).toBeLessThan(
      listUserPosts.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('still shows the posts if the check does nothing', async () => {
    syncDueSchedules.mockResolvedValue(0)
    const { html, errors } = await render()
    expect(errors).toEqual([])
    expect(html).toContain('Just shipped a major update')
  })

  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    const { errors } = await render()
    expect(String(errors[0])).toContain('redirect:/sign-in')
    expect(listUserPosts).not.toHaveBeenCalled()
  })

  it('shows the title, the tabs with counts, the search and the rows', async () => {
    const { html } = await render()
    expect(html).toContain('Manage your LinkedIn content across all projects.')
    for (const tab of [
      'All posts',
      'Drafts',
      'Scheduled',
      'Published',
      'Failed',
    ]) {
      expect(html).toContain(tab)
    }
    expect(html).toMatch(/All posts<span[^>]*>2<\/span>/)
    expect(html).toContain('role="search"')
    expect(html).toContain('Just shipped a major update')
    expect(html).toContain('How we reduced incident response time')
    expect(html).toContain('Proposal Generator')
    expect(html).toContain('2 posts')
  })

  it('shows dates in UTC with the time', async () => {
    const { html } = await render()
    expect(html).toContain('Oct 30, 2026')
    expect(html).toContain('10:00 AM UTC')
  })

  it('previews the first post, and the one picked in the address', async () => {
    const first = await render()
    expect(first.html).toContain('Post preview')
    expect(first.html).toContain('How we reduced incident response time')
    const picked = await render({ sel: `d:${D1}` })
    const preview = picked.html.split('aria-label="Post preview"')[1] ?? ''
    expect(preview).toContain('Key improvements')
    expect(preview).toContain(`/dashboard/projects/${PROJECT}?tab=drafts`)
  })

  it('previews the selected post as it will look on LinkedIn', async () => {
    const scheduled = await render()
    const side = scheduled.html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('aria-label="LinkedIn post preview"')
    expect(side).toContain('How we reduced incident response time')
    expect(side).toContain('Your LinkedIn profile')
    // A scheduled post shows when it goes out, in UTC.
    expect(side).toContain('Oct 30, 10:00 AM UTC')
    for (const action of ['Like', 'Comment', 'Repost', 'Send']) {
      expect(side).toContain(action)
    }
    // A draft has no time yet.
    const draft = await render({ sel: `d:${D1}` })
    const draftSide = draft.html.split('aria-label="Post preview"')[1] ?? ''
    expect(draftSide).toContain('aria-label="LinkedIn post preview"')
    expect(draftSide).toContain('Now')
    expect(draftSide).not.toContain('UTC')
  })

  it('ignores a selection that is not one of the user’s rows', async () => {
    const { html } = await render({
      sel: `d:${'0'.repeat(8)}-0000-0000-0000-000000000000`,
    })
    expect(html).toContain('How we reduced incident response time')
    const bad = await render({ sel: '"><script>alert(1)</script>' })
    expect(bad.html).not.toContain('<script>alert')
  })

  it('filters by tab and by search', async () => {
    const drafts = await render({ tab: 'drafts' })
    expect(drafts.html).toContain('Just shipped a major update')
    expect(drafts.html).not.toContain(
      'How we reduced incident response time</span>',
    )
    const search = await render({ q: 'incident' })
    expect(search.html).toContain('How we reduced incident response time')
    expect(search.html).not.toContain('Just shipped a major update</span>')
    const none = await render({ q: 'zzz' })
    expect(none.html).toContain('No posts match your search.')
    expect(none.html).toContain('Clear the search')
  })

  it('an odd tab or page falls back to the defaults', async () => {
    const { html } = await render({ tab: 'nope', page: '-3' })
    expect(html).toContain('2 posts')
  })

  it('escapes post text and the search text', async () => {
    listUserPosts.mockResolvedValue({
      drafts: [draft({ body: '<img src=x onerror=alert(1)>' })],
      schedules: [],
      truncated: false,
    })
    const { html } = await render({ q: '"><script>x</script>' })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>x')
  })

  it('pages a long list', async () => {
    listUserPosts.mockResolvedValue({
      drafts: Array.from({ length: 19 }, (_, i) =>
        draft({
          id: `aaaaaaaa-2222-4333-8444-${String(i).padStart(12, '0')}`,
          body: `Post number ${String(i)}`,
          createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00Z`,
        }),
      ),
      schedules: [],
      truncated: false,
    })
    const first = await render()
    expect(first.html).toContain('Page 1 of 3')
    expect(first.html).toContain('Next page')
    expect(first.html).not.toContain('Previous page')
    const last = await render({ page: '99' })
    expect(last.html).toContain('Page 3 of 3')
    expect(last.html).toContain('Previous page')
    expect(last.html).toContain('19 posts')
  })

  it('says so when the list was cut', async () => {
    listUserPosts.mockResolvedValue({
      drafts: [draft()],
      schedules: [],
      truncated: true,
    })
    const { html } = await render()
    expect(html).toContain('Showing your newest posts.')
  })

  it('a deleted project is named plainly', async () => {
    listUserPosts.mockResolvedValue({
      drafts: [],
      schedules: [schedule({ projectId: null })],
      truncated: false,
    })
    const { html } = await render()
    expect(html).toContain('Deleted project')
    expect(html).not.toContain('Open in project')
  })

  it('has an empty state with no posts', async () => {
    listUserPosts.mockResolvedValue({
      drafts: [],
      schedules: [],
      truncated: false,
    })
    const { html } = await render()
    expect(html).toContain('No posts yet')
    expect(html).toContain('Go to your projects')
    expect(html).toContain('Select a post to preview it.')
  })

  it('shows a plain error if the posts or projects cannot be read', async () => {
    listUserPosts.mockResolvedValue(null)
    expect((await render()).html).toContain('We could not load your posts.')
    listUserPosts.mockResolvedValue({
      drafts: [],
      schedules: [],
      truncated: false,
    })
    listProjects.mockResolvedValue({ ok: false })
    expect((await render()).html).toContain('We could not load your posts.')
  })

  it('offers Generate post only while AI is on', async () => {
    expect((await render()).html).toContain('Generate post')
    aiIsEnabled.mockReturnValue(false)
    expect((await render()).html).not.toContain('Generate post')
  })

  it('never lets Shipnote post for the user, and says so', async () => {
    const { html } = await render()
    expect(html).toContain('Shipnote never posts for you.')
    expect(html).not.toContain('Publish now')
  })
})
