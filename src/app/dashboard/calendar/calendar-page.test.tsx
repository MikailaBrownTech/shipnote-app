import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The calendar page, rendered on the server with a fixed clock: Wednesday
// 28 October 2026, so the current week is Monday 26 October to Sunday 1 November.

const requireUser = vi.fn()
const listSchedulesBetween = vi.fn()
const getScheduledPost = vi.fn()
const listProjects = vi.fn()
const schedulingIsEnabled = vi.fn()
const aiIsEnabled = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/scheduled-posts', () => ({
  listSchedulesBetween,
  getScheduledPost,
}))
vi.mock('@/server/projects', () => ({ listProjects }))
vi.mock('@/server/scheduling', () => ({ schedulingIsEnabled }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled }))

const { default: CalendarPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const ID = 'aaaaaaaa-2222-4333-8444-555555555555'

const post = (over: Record<string, unknown> = {}) => ({
  id: ID,
  projectId: PROJECT,
  draftId: null,
  body: 'Project update\n\nMore text here',
  channelLabel: 'My LinkedIn',
  scheduledFor: '2026-10-28T10:00:00Z',
  bufferPostId: null,
  status: 'scheduled',
  failureCode: null,
  createdAt: '2026-10-27T10:00:00Z',
  ...over,
})

const uid = (n: number) =>
  `aaaaaaaa-2222-4333-8444-${String(n).padStart(12, '0')}`

async function render(search: Record<string, string> = {}) {
  const element: ReactElement = (
    <CalendarPage
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

// The part of the page between two markers.
const between = (html: string, from: string, to: string) =>
  html.split(from)[1]?.split(to)[0] ?? ''

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  schedulingIsEnabled.mockReturnValue(true)
  aiIsEnabled.mockReturnValue(true)
  listSchedulesBetween.mockResolvedValue([post()])
  getScheduledPost.mockResolvedValue('not_found')
  listProjects.mockResolvedValue({
    ok: true,
    value: [{ id: PROJECT, name: 'Proposal Generator' }],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the week view', () => {
  it('needs a signed-in user and reads only their own week', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
    expect(listSchedulesBetween).toHaveBeenCalledExactlyOnceWith(
      USER,
      '2026-10-26T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    )
    expect(listProjects).toHaveBeenCalledExactlyOnceWith(USER)
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    listSchedulesBetween.mockClear()
    const denied = await render()
    expect(String(denied.errors[0])).toContain('redirect:/sign-in')
    expect(listSchedulesBetween).not.toHaveBeenCalled()
  })

  it('shows the title, the week and seven days, Monday to Sunday', async () => {
    const { html } = await render()
    expect(html).toMatch(/<h1>(<span[^>]*>)?Calendar/)
    expect(html).toContain('Times are in UTC.')
    expect(html).toContain('Oct 26 – Nov 1, 2026')
    for (const label of [
      'Mon 26',
      'Tue 27',
      'Wed 28',
      'Thu 29',
      'Fri 30',
      'Sat 31',
      'Sun 1',
    ]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
  })

  it('puts a post on its day, with its title, time and status', async () => {
    const { html } = await render()
    const wednesday = between(
      html,
      'aria-label="Wed 28"',
      'aria-label="Thu 29"',
    )
    expect(wednesday).toContain('<strong>Project update</strong>')
    expect(wednesday).toContain('10:00 AM UTC')
    expect(wednesday).toContain('Scheduled')
    expect(wednesday).toContain(`post=${ID}`)
    expect(
      between(html, 'aria-label="Tue 27"', 'aria-label="Wed 28"'),
    ).not.toContain('Project update')
    expect(html).toContain('1 post this week.')
  })

  it('shows each status, and orders a day earliest first', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({
        id: uid(1),
        status: 'scheduling',
        scheduledFor: '2026-10-26T09:00:00Z',
      }),
      post({
        id: uid(2),
        status: 'published',
        scheduledFor: '2026-10-27T09:00:00Z',
      }),
      post({
        id: uid(3),
        status: 'failed',
        scheduledFor: '2026-10-29T09:00:00Z',
      }),
      post({
        id: uid(4),
        body: 'Later one',
        scheduledFor: '2026-10-30T15:00:00Z',
      }),
      post({
        id: uid(5),
        body: 'Earlier one',
        scheduledFor: '2026-10-30T08:00:00Z',
      }),
    ])
    const { html } = await render()
    const grid = between(html, '<ol', '</ol>')
    for (const word of ['Scheduling', 'Published', 'Failed']) {
      expect(grid).toContain(`>${word}<`)
    }
    expect(grid.indexOf('Earlier one')).toBeLessThan(grid.indexOf('Later one'))
    expect(html).toContain('5 posts this week.')
  })

  it('marks today', async () => {
    const { html } = await render()
    const marked = [
      ...html.matchAll(/<li class="[^"]*_today_[^"]*" aria-label="([^"]+)"/g),
    ].map((m) => m[1])
    expect(marked).toEqual(['Wed 28'])
  })

  it('moves a week at a time, and today’s week has no date in its address', async () => {
    const { html } = await render()
    expect(html).toContain('href="/dashboard/calendar?date=2026-10-21"')
    expect(html).toContain('href="/dashboard/calendar?date=2026-11-04"')
    expect(html).toContain('This week</a>')
    const next = await render({ date: '2026-11-04' })
    expect(next.html).toContain('Nov 2 – Nov 8, 2026')
    expect(listSchedulesBetween).toHaveBeenLastCalledWith(
      USER,
      '2026-11-02T00:00:00.000Z',
      '2026-11-09T00:00:00.000Z',
    )
    expect(next.html).not.toMatch(/aria-current="page"[^>]*>This week/)
  })

  it('an odd date is today’s week, and nothing is echoed', async () => {
    for (const bad of [
      'next',
      '2026-02-31',
      '"><script>x</script>',
      '2099-01-01',
    ]) {
      const { html } = await render({ date: bad })
      expect(html).toContain('Oct 26 – Nov 1, 2026')
      expect(html).not.toContain('<script>x')
    }
  })

  it('stops offering periods beyond two years', async () => {
    const edge = await render({ date: '2028-10-27' })
    expect(edge.html).toContain('aria-label="Previous week"')
    expect(edge.html).not.toContain('aria-label="Next week"')
  })

  it('says so when nothing is scheduled', async () => {
    listSchedulesBetween.mockResolvedValue([])
    const { html } = await render()
    expect(html).toContain('Nothing is scheduled this week.')
    expect(html).toContain('Nothing scheduled')
  })
})

describe('the month view', () => {
  it('reads the whole grid for the month, and labels it', async () => {
    const { html } = await render({ view: 'month' })
    expect(html).toContain('October 2026')
    expect(listSchedulesBetween).toHaveBeenCalledExactlyOnceWith(
      USER,
      '2026-09-28T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    )
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(html).toContain(`role="columnheader">${d}<`)
    }
    expect(html.match(/role="gridcell"/g)).toHaveLength(35)
  })

  it('a month that needs six rows or four rows is shown whole', async () => {
    expect(
      (await render({ view: 'month', date: '2026-11-10' })).html.match(
        /role="gridcell"/g,
      ),
    ).toHaveLength(42)
    expect(
      (await render({ view: 'month', date: '2027-02-10' })).html.match(
        /role="gridcell"/g,
      ),
    ).toHaveLength(28)
  })

  it('puts a post in its day, and dims the days of other months', async () => {
    listSchedulesBetween.mockResolvedValue([
      post(),
      post({
        id: uid(2),
        body: 'Last of September',
        scheduledFor: '2026-09-30T10:00:00Z',
      }),
    ])
    const { html } = await render({ view: 'month' })
    const cell = (label: string) =>
      html.split(`aria-label="${label}`)[1]?.split('role="gridcell"')[0] ?? ''
    expect(cell('Wed 28, 1 post')).toContain('Project update')
    expect(cell('Wed 30, 1 post')).toContain('Last of September')
    const outside = [
      ...html.matchAll(/class="[^"]*_outside_[^"]*"[^>]*aria-label="([^"]+)"/g),
    ].map((m) => m[1])
    expect(outside.some((l) => l.startsWith('Wed 30'))).toBe(true)
    expect(outside.some((l) => l.startsWith('Wed 28'))).toBe(false)
  })

  it('shows three cards a day and a link for the rest, to that week', async () => {
    listSchedulesBetween.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) =>
        post({
          id: uid(i + 1),
          body: `Post number ${String(i + 1)}`,
          scheduledFor: `2026-10-14T0${String(i + 1)}:00:00Z`,
        }),
      ),
    )
    const { html } = await render({ view: 'month' })
    expect(html).toContain('+2 more')
    expect(html).toContain('href="/dashboard/calendar?date=2026-10-14"')
    expect(html).toContain('Post number 3')
    expect(html).not.toContain('Post number 4')
    expect(html).toContain('5 posts this month.')
  })

  it('moves a month at a time, and keeps the view in every link', async () => {
    const { html } = await render({ view: 'month' })
    expect(html).toContain(
      'href="/dashboard/calendar?view=month&amp;date=2026-09-01"',
    )
    expect(html).toContain(
      'href="/dashboard/calendar?view=month&amp;date=2026-11-01"',
    )
    expect(html).toContain('aria-label="Previous month"')
    expect(html).toContain('This month</a>')
    const next = await render({ view: 'month', date: '2026-11-01' })
    expect(next.html).toContain('November 2026')
  })

  it('switches between the views', async () => {
    const week = await render()
    expect(week.html).toContain('aria-label="Calendar view"')
    expect(week.html).toMatch(/aria-current="page"[^>]*>Week</)
    expect(week.html).toContain('href="/dashboard/calendar?view=month"')
    const month = await render({ view: 'month' })
    expect(month.html).toMatch(/aria-current="page"[^>]*>Month</)
    expect(month.html).toContain('href="/dashboard/calendar"')
  })

  it('an odd view is the week', async () => {
    const { html } = await render({ view: 'year' })
    expect(html).toContain('Oct 26 – Nov 1, 2026')
    expect(html).not.toContain('role="gridcell"')
  })

  it('says so when nothing is scheduled this month', async () => {
    listSchedulesBetween.mockResolvedValue([])
    const { html } = await render({ view: 'month' })
    expect(html).toContain('Nothing is scheduled this month.')
  })
})

describe('the post preview', () => {
  it('previews the first post by default, as it will read', async () => {
    const { html } = await render()
    const side = html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('Post preview')
    expect(side).toContain('Project update')
    expect(side).toContain('More text here')
    expect(side).toContain('Oct 28, 2026')
    expect(side).toContain('10:00 AM')
    expect(side).toContain('UTC')
    expect(side).toContain('To My LinkedIn')
    expect(side).toContain('Proposal Generator')
    expect(side).toContain('>Scheduled<')
    expect(side).toContain('30/3,000')
  })

  it('links to the post in Posts and to its project', async () => {
    const { html } = await render()
    const side = html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain(`href="/dashboard/posts?sel=s:${ID}"`)
    expect(side).toContain(`href="/dashboard/projects/${PROJECT}?tab=drafts"`)
    expect(side).toContain('Shipnote never posts for you.')
  })

  it('previews the post chosen in the address, and marks its card', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({ id: uid(1), body: 'First one' }),
      post({
        id: uid(2),
        body: 'Second one',
        scheduledFor: '2026-10-29T10:00:00Z',
      }),
    ])
    const { html } = await render({ post: uid(2) })
    const side = html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('Second one')
    expect(side).not.toContain('First one')
    expect(html).toMatch(/_postOn_[^"]*"[^>]*aria-current="true"/)
    expect(getScheduledPost).not.toHaveBeenCalled()
  })

  it('finds a post outside the days shown, for this user only', async () => {
    getScheduledPost.mockResolvedValue(
      post({
        id: uid(9),
        body: 'From another week',
        scheduledFor: '2026-12-01T10:00:00Z',
      }),
    )
    const { html } = await render({ post: uid(9) })
    expect(getScheduledPost).toHaveBeenCalledExactlyOnceWith(USER, uid(9))
    const side = html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('From another week')
    expect(side).toContain('Dec 1, 2026')
  })

  it('shows nothing for a post that is not theirs or does not exist', async () => {
    getScheduledPost.mockResolvedValue('not_found')
    const { html } = await render({ post: uid(8) })
    const side = html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('Select a post to preview it.')
    expect(side).not.toContain('Project update')
    getScheduledPost.mockResolvedValue('failed')
    expect((await render({ post: uid(8) })).html).toContain(
      'Select a post to preview it.',
    )
  })

  it('ignores a post in the address that is not shaped like an id', async () => {
    for (const bad of ['x', '"><script>y</script>', '../etc']) {
      const { html } = await render({ post: bad })
      expect(getScheduledPost).not.toHaveBeenCalled()
      expect(html).not.toContain('<script>y')
      expect(html.split('aria-label="Post preview"')[1]).toContain(
        'Project update',
      )
    }
  })

  it('has a prompt when there is no post to show', async () => {
    listSchedulesBetween.mockResolvedValue([])
    const { html } = await render()
    expect(html).toContain('Select a post to preview it.')
  })

  it('says plainly that a failed post could not be scheduled', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({ status: 'failed', failureCode: 'x' }),
    ])
    const { html } = await render()
    expect(html).toContain('This post could not be scheduled.')
    expect(html).not.toContain('>x<')
  })

  it('a deleted project is named plainly, with no project link', async () => {
    listSchedulesBetween.mockResolvedValue([post({ projectId: null })])
    const side =
      (await render()).html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('Deleted project')
    expect(side).not.toContain('Open project')
  })

  it('still previews if the project names cannot be read', async () => {
    listProjects.mockResolvedValue({ ok: false })
    const side =
      (await render()).html.split('aria-label="Post preview"')[1] ?? ''
    expect(side).toContain('Project update')
    expect(side).toContain('Deleted project')
  })

  it('shows the post as text, never as markup', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({ body: '<img src=x onerror=alert(1)><script>alert(1)</script>' }),
    ])
    const { html } = await render()
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
  })
})

describe('the rest of the page', () => {
  it('shortens a long first line on the card', async () => {
    listSchedulesBetween.mockResolvedValue([post({ body: 'w'.repeat(300) })])
    const grid = between((await render()).html, '<ol', '</ol>')
    expect(grid).not.toContain('w'.repeat(60))
    expect(grid).toContain('…')
  })

  it('a plain message if the calendar cannot be read', async () => {
    listSchedulesBetween.mockResolvedValue(null)
    const { html } = await render()
    expect(html).toContain('We could not load your calendar.')
    expect(html).not.toContain('Previous week')
  })

  it('says so while scheduling is off, and still shows earlier posts', async () => {
    schedulingIsEnabled.mockReturnValue(false)
    const { html } = await render()
    expect(html).toContain('Scheduling is switched off right now')
    expect(html).toContain('Project update')
  })

  it('offers New post only while drafting is on', async () => {
    expect((await render()).html).toContain('New post')
    aiIsEnabled.mockReturnValue(false)
    expect((await render()).html).not.toContain('New post')
  })
})
