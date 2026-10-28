// The calendar: which week or month is shown, its days, and which posts fall on
// which day. Everything is in UTC, like every other date in the app. Pure, so
// each rule is tested without a server.

export const DAY_MS = 86_400_000
// A period further than this from today is not shown, so the address cannot ask
// for an absurd range.
export const MAX_DAYS_AWAY = 730

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type CalendarView = 'week' | 'month'

// Only a view from the fixed list; anything else is the week.
export function chooseView(value: unknown): CalendarView {
  return value === 'month' ? 'month' : 'week'
}

// A scheduled post chosen in the address, only if it has the shape of an id.
export function choosePostId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

// "2026-10-26" as the UTC midnight it starts, or null if it is not a real date.
export function parseDay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = ISO_DAY.exec(value)
  if (!match) return null
  const [, y, m, d] = match
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d))
  const back = new Date(ms)
  // Rejects dates such as 2026-02-31, which Date would roll over.
  return back.getUTCFullYear() === Number(y) &&
    back.getUTCMonth() === Number(m) - 1 &&
    back.getUTCDate() === Number(d)
    ? ms
    : null
}

export function toIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The UTC midnight of the day an instant falls on.
export function dayStart(ms: number): number {
  const date = new Date(ms)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

// The Monday (UTC midnight) of the week the instant falls in.
export function mondayOf(ms: number): number {
  const date = new Date(ms)
  const sinceMonday = (date.getUTCDay() + 6) % 7
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - sinceMonday,
  )
}

// The first day of the month the instant falls in (UTC midnight).
export function monthStart(ms: number): number {
  const date = new Date(ms)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

export function todayStart(nowMs: number = Date.now()): number {
  return dayStart(nowMs)
}

// Today's date in UTC, as "2026-10-28".
export function todayIso(nowMs: number = Date.now()): string {
  return toIsoDay(nowMs)
}

// Whether a day is close enough to today to be shown.
export function dayAllowed(ms: number, nowMs?: number): boolean {
  return Math.abs(dayStart(ms) - todayStart(nowMs)) <= MAX_DAYS_AWAY * DAY_MS
}

// The day the calendar is centred on: the date from the address if it is a real
// date that is not too far away, otherwise today.
export function chooseAnchor(
  value: unknown,
  nowMs: number = Date.now(),
): number {
  const day = parseDay(value)
  return day !== null && dayAllowed(day, nowMs) ? day : todayStart(nowMs)
}

export type CalendarDay = {
  iso: string
  weekday: (typeof WEEKDAYS)[number]
  day: number
  // False for the days of a month grid that belong to the previous or next month.
  inMonth: boolean
}

function dayOf(ms: number, inMonth = true): CalendarDay {
  const date = new Date(ms)
  return {
    iso: toIsoDay(ms),
    weekday: WEEKDAYS[(date.getUTCDay() + 6) % 7] ?? 'Mon',
    day: date.getUTCDate(),
    inMonth,
  }
}

// The seven days of the week the anchor falls in, Monday to Sunday.
export function weekDays(anchorMs: number): CalendarDay[] {
  const monday = mondayOf(anchorMs)
  return WEEKDAYS.map((_, index) => dayOf(monday + index * DAY_MS))
}

// The weeks of the month the anchor falls in, each Monday to Sunday, from the
// week of the 1st to the week of the last day (five or six rows).
export function monthWeeks(anchorMs: number): CalendarDay[][] {
  const first = monthStart(anchorMs)
  const date = new Date(first)
  const month = date.getUTCMonth()
  const lastDay = Date.UTC(date.getUTCFullYear(), month + 1, 0)
  const weeks: CalendarDay[][] = []
  for (let monday = mondayOf(first); monday <= lastDay; monday += 7 * DAY_MS) {
    weeks.push(
      WEEKDAYS.map((_, index) => {
        const ms = monday + index * DAY_MS
        return dayOf(ms, new Date(ms).getUTCMonth() === month)
      }),
    )
  }
  return weeks
}

// The first instant shown and the first instant after it, for the query. For a
// month this covers the whole grid, so the days of the neighbouring months that
// the grid shows are filled in too.
export function rangeFor(
  view: CalendarView,
  anchorMs: number,
): { from: string; to: string } {
  if (view === 'week') {
    const monday = mondayOf(anchorMs)
    return {
      from: new Date(monday).toISOString(),
      to: new Date(monday + 7 * DAY_MS).toISOString(),
    }
  }
  const rows = monthWeeks(anchorMs).length
  const start = mondayOf(monthStart(anchorMs))
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + rows * 7 * DAY_MS).toISOString(),
  }
}

// The anchor of the previous or next period: a week earlier or later, or the
// first of the previous or next month.
export function shiftAnchor(
  view: CalendarView,
  anchorMs: number,
  direction: -1 | 1,
): number {
  if (view === 'week') return dayStart(anchorMs) + direction * 7 * DAY_MS
  const date = new Date(anchorMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1)
}

// Whether two anchors show the same week or month.
export function samePeriod(view: CalendarView, a: number, b: number): boolean {
  return view === 'week'
    ? mondayOf(a) === mondayOf(b)
    : monthStart(a) === monthStart(b)
}

const monthDay = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const full = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthYear = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

// "Oct 26 – Nov 1, 2026" for a week (with both years when it spans two) and
// "October 2026" for a month.
export function periodLabel(view: CalendarView, anchorMs: number): string {
  if (view === 'month') return monthYear.format(anchorMs)
  const monday = mondayOf(anchorMs)
  const sunday = monday + 6 * DAY_MS
  const sameYear =
    new Date(monday).getUTCFullYear() === new Date(sunday).getUTCFullYear()
  return sameYear
    ? `${monthDay.format(monday)} – ${full.format(sunday)}`
    : `${full.format(monday)} – ${full.format(sunday)}`
}

// The address of a calendar page. What matches the defaults is left out: the
// week view, and the date when it is in the period that holds today.
export function calendarHref(
  target: { view: CalendarView; anchor: number; post?: string | null },
  nowMs?: number,
): string {
  const params = new URLSearchParams()
  if (target.view === 'month') params.set('view', 'month')
  if (!samePeriod(target.view, target.anchor, todayStart(nowMs))) {
    params.set('date', toIsoDay(target.anchor))
  }
  if (target.post) params.set('post', target.post)
  const query = params.toString()
  return query ? `/dashboard/calendar?${query}` : '/dashboard/calendar'
}

const clock = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

// "10:00 AM", in UTC. Empty for a time that cannot be read.
export function timeOfDay(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : clock.format(ms)
}

// Posts by the UTC day they fall on, each day earliest first. A post that is
// not on one of the given days is left out.
export function groupByDay<T extends { scheduledFor: string }>(
  posts: readonly T[],
  days: readonly { iso: string }[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>(days.map((day) => [day.iso, []]))
  for (const post of posts) {
    const ms = Date.parse(post.scheduledFor)
    if (Number.isNaN(ms)) continue
    grouped.get(toIsoDay(ms))?.push(post)
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))
  }
  return grouped
}

// The first line of a post, short, for a calendar card.
export function cardTitle(body: string, max = 48): string {
  const line =
    body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? ''
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}
