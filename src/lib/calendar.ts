// The week view of the calendar: which week is shown, its seven days, and which
// posts fall on which day. Everything is in UTC, like every other date in the
// app. Pure, so each rule is tested without a server.

export const DAY_MS = 86_400_000
// A week further than this from the current one is not shown, so the address
// cannot ask for an absurd range.
export const MAX_WEEKS_AWAY = 104

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

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

export function currentWeek(nowMs: number = Date.now()): number {
  return mondayOf(nowMs)
}

// The week from the address: any day in it picks its week. Anything that is not
// a real date, or is too far away, is the current week.
export function chooseWeek(value: unknown, nowMs: number = Date.now()): number {
  const now = currentWeek(nowMs)
  const day = parseDay(value)
  if (day === null) return now
  const monday = mondayOf(day)
  return Math.abs(monday - now) > MAX_WEEKS_AWAY * 7 * DAY_MS ? now : monday
}

export type CalendarDay = {
  iso: string
  weekday: (typeof WEEKDAYS)[number]
  day: number
}

export function weekDays(mondayMs: number): CalendarDay[] {
  return WEEKDAYS.map((weekday, index) => {
    const ms = mondayMs + index * DAY_MS
    return {
      iso: toIsoDay(ms),
      weekday,
      day: new Date(ms).getUTCDate(),
    }
  })
}

// The first instant of the week and the first instant after it, for the query.
export function weekBounds(mondayMs: number): { from: string; to: string } {
  return {
    from: new Date(mondayMs).toISOString(),
    to: new Date(mondayMs + 7 * DAY_MS).toISOString(),
  }
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

// "Oct 26 – Nov 1, 2026", or with both years when the week spans two.
export function weekLabel(mondayMs: number): string {
  const sunday = mondayMs + 6 * DAY_MS
  const sameYear =
    new Date(mondayMs).getUTCFullYear() === new Date(sunday).getUTCFullYear()
  return sameYear
    ? `${monthDay.format(mondayMs)} – ${full.format(sunday)}`
    : `${full.format(mondayMs)} – ${full.format(sunday)}`
}

// The address of a week. The current week has none.
export function calendarHref(mondayMs: number, nowMs?: number): string {
  return mondayMs === currentWeek(nowMs)
    ? '/dashboard/calendar'
    : `/dashboard/calendar?week=${toIsoDay(mondayMs)}`
}

// Whether a week is inside the range that can be shown.
export function weekAllowed(mondayMs: number, nowMs?: number): boolean {
  return Math.abs(mondayMs - currentWeek(nowMs)) <= MAX_WEEKS_AWAY * 7 * DAY_MS
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
  days: readonly CalendarDay[],
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

// Today's date in UTC, as "2026-10-28".
export function todayIso(nowMs: number = Date.now()): string {
  return toIsoDay(nowMs)
}
