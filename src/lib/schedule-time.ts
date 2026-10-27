// Turning the date and time a person picked (in their own time zone) into a
// UTC instant, and checking it is a sensible time to schedule.
//
// No imports. The browser sends a wall-clock time like "2026-11-03T09:30" and
// its IANA time zone name; the server converts it here and never trusts a UTC
// time from the form.

export const MIN_LEAD_MS = 10 * 60 * 1000
export const MAX_LEAD_MS = 30 * 24 * 60 * 60 * 1000

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function isTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// The zone's offset from UTC in milliseconds at an instant.
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

export type ScheduleTime =
  | { ok: true; utc: Date }
  | { ok: false; reason: 'invalid' | 'too_soon' | 'too_far' }

export function parseScheduleTime(input: {
  local: string
  timeZone: string
  nowMs: number
}): ScheduleTime {
  const match = LOCAL.exec(input.local)
  if (!match || !isTimeZone(input.timeZone))
    return { ok: false, reason: 'invalid' }
  const [, y, mo, d, h, mi] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  // Reject dates like 2026-02-31 and times like 25:00 rather than rolling over.
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const check = new Date(wall)
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return { ok: false, reason: 'invalid' }
  }

  // Two passes find the offset in force at the wanted wall-clock time, even
  // across a daylight-saving change.
  let guess = wall - offsetMs(wall, input.timeZone)
  guess = wall - offsetMs(guess, input.timeZone)
  const utc = new Date(guess)
  if (Number.isNaN(utc.getTime())) return { ok: false, reason: 'invalid' }

  const lead = guess - input.nowMs
  if (lead < MIN_LEAD_MS) return { ok: false, reason: 'too_soon' }
  if (lead > MAX_LEAD_MS) return { ok: false, reason: 'too_far' }
  return { ok: true, utc }
}
