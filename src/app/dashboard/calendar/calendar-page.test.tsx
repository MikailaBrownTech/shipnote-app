import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The calendar page, rendered on the server with a fixed clock: Wednesday
// 28 October 2026, so the current week is Monday 26 October to Sunday 1 November.

const requireUser = vi.fn()
const listSchedulesBetween = vi.fn()
const schedulingIsEnabled = vi.fn()
const aiIsEnabled = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/scheduled-posts', () => ({ listSchedulesBetween }))
vi.mock('@/server/scheduling', () => ({ schedulingIsEnabled }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled }))

const { default: CalendarPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'

const post = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-2222-4333-8444-555555555555',
  projectId: null,
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  schedulingIsEnabled.mockReturnValue(true)
  aiIsEnabled.mockReturnValue(true)
  listSchedulesBetween.mockResolvedValue([post()])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the calendar', () => {
  it('needs a signed-in user and reads only their own week', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
    expect(listSchedulesBetween).toHaveBeenCalledExactlyOnceWith(
      USER,
      '2026-10-26T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    )
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

  it('puts a post on its day, with its title, time and status, linked to Posts', async () => {
    const { html } = await render()
    const wednesday =
      html.split('aria-label="Wed 28"')[1]?.split('aria-label="Thu 29"')[0] ??
      ''
    expect(wednesday).toContain('<strong>Project update</strong>')
    expect(wednesday).toContain('10:00 AM UTC')
    expect(wednesday).toContain('Scheduled')
    expect(wednesday).toContain(
      'href="/dashboard/posts?sel=s:aaaaaaaa-2222-4333-8444-555555555555"',
    )
    const tuesday =
      html.split('aria-label="Tue 27"')[1]?.split('aria-label="Wed 28"')[0] ??
      ''
    expect(tuesday).not.toContain('Project update')
    expect(html).toContain('1 post this week.')
  })

  it('shows each status', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({
        id: 'a1',
        status: 'scheduling',
        scheduledFor: '2026-10-26T09:00:00Z',
      }),
      post({
        id: 'a2',
        status: 'published',
        scheduledFor: '2026-10-27T09:00:00Z',
      }),
      post({
        id: 'a3',
        status: 'failed',
        scheduledFor: '2026-10-29T09:00:00Z',
      }),
    ])
    const { html } = await render()
    for (const word of ['Scheduling', 'Published', 'Failed']) {
      expect(html).toContain(`>${word}<`)
    }
    expect(html).toContain('3 posts this week.')
  })

  it('orders posts within a day, earliest first', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({
        id: 'b2',
        body: 'Later one',
        scheduledFor: '2026-10-28T15:00:00Z',
      }),
      post({
        id: 'b1',
        body: 'Earlier one',
        scheduledFor: '2026-10-28T08:00:00Z',
      }),
    ])
    const { html } = await render()
    expect(html.indexOf('Earlier one')).toBeGreaterThan(-1)
    expect(html.indexOf('Earlier one')).toBeLessThan(html.indexOf('Later one'))
  })

  it('marks today', async () => {
    const { html } = await render()
    const marked = [
      ...html.matchAll(/<li class="[^"]*_today_[^"]*" aria-label="([^"]+)"/g),
    ].map((m) => m[1])
    expect(marked).toEqual(['Wed 28'])
  })

  it('moves a week at a time, and the current week has no address of its own', async () => {
    const { html } = await render()
    expect(html).toContain('href="/dashboard/calendar?week=2026-10-19"')
    expect(html).toContain('href="/dashboard/calendar?week=2026-11-02"')
    expect(html).toContain('aria-current="page"')
    const next = await render({ week: '2026-11-02' })
    expect(next.html).toContain('Nov 2 – Nov 8, 2026')
    expect(listSchedulesBetween).toHaveBeenLastCalledWith(
      USER,
      '2026-11-02T00:00:00.000Z',
      '2026-11-09T00:00:00.000Z',
    )
    expect(next.html).toContain('href="/dashboard/calendar"')
    expect(next.html).not.toContain('aria-current="page"')
  })

  it('any day in a week picks that week, and an odd value is this week', async () => {
    expect((await render({ week: '2026-11-04' })).html).toContain(
      'Nov 2 – Nov 8, 2026',
    )
    for (const bad of [
      'next',
      '2026-02-31',
      '"><script>x</script>',
      '2099-01-01',
    ]) {
      const { html } = await render({ week: bad })
      expect(html).toContain('Oct 26 – Nov 1, 2026')
      expect(html).not.toContain('<script>x')
    }
  })

  it('stops offering weeks beyond two years', async () => {
    const edge = await render({ week: '2028-10-23' })
    expect(edge.html).toContain('aria-label="Previous week"')
    expect(edge.html).not.toContain('aria-label="Next week"')
  })

  it('says so when nothing is scheduled', async () => {
    listSchedulesBetween.mockResolvedValue([])
    const { html } = await render()
    expect(html).toContain('Nothing is scheduled this week.')
    expect(html).toContain('Nothing scheduled')
  })

  it('shows post text as text, never as markup', async () => {
    listSchedulesBetween.mockResolvedValue([
      post({ body: '<img src=x onerror=alert(1)><script>alert(1)</script>' }),
    ])
    const { html } = await render()
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
  })

  it('shortens a long first line', async () => {
    listSchedulesBetween.mockResolvedValue([post({ body: 'w'.repeat(300) })])
    const { html } = await render()
    expect(html).not.toContain('w'.repeat(60))
    expect(html).toContain('…')
  })

  it('a plain message if the week cannot be read', async () => {
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
