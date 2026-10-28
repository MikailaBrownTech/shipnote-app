import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  MAX_WEEKS_AWAY,
  calendarHref,
  cardTitle,
  chooseWeek,
  currentWeek,
  groupByDay,
  mondayOf,
  parseDay,
  timeOfDay,
  todayIso,
  toIsoDay,
  weekAllowed,
  weekBounds,
  weekDays,
  weekLabel,
} from './calendar'

// Wednesday 28 October 2026, so the week is Monday 26 Oct to Sunday 1 Nov.
const NOW = Date.parse('2026-10-28T12:00:00Z')
const MONDAY = Date.parse('2026-10-26T00:00:00Z')

describe('parseDay', () => {
  it('reads a real date as the UTC midnight it starts', () => {
    expect(parseDay('2026-10-26')).toBe(MONDAY)
    expect(parseDay('2028-02-29')).toBe(Date.parse('2028-02-29T00:00:00Z'))
  })

  it.each([
    '2026-02-31',
    '2026-13-01',
    '2026-00-10',
    '2027-02-29',
    '26-10-26',
    '2026-10-26T00:00:00Z',
    ' 2026-10-26',
    '2026/10/26',
    '',
  ])('refuses %j', (bad) => {
    expect(parseDay(bad)).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    for (const bad of [undefined, null, 20261026, ['2026-10-26'], {}]) {
      expect(parseDay(bad)).toBeNull()
    }
  })
})

describe('weeks', () => {
  it('a week starts on Monday, whichever day is asked for', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(mondayOf(MONDAY + i * DAY_MS + 5 * 3_600_000)).toBe(MONDAY)
    }
    expect(mondayOf(MONDAY + 7 * DAY_MS)).toBe(MONDAY + 7 * DAY_MS)
    expect(currentWeek(NOW)).toBe(MONDAY)
  })

  it('crosses a year end correctly', () => {
    // Thursday 1 Jan 2026 belongs to the week starting Monday 29 Dec 2025.
    expect(toIsoDay(mondayOf(Date.parse('2026-01-01T09:00:00Z')))).toBe(
      '2025-12-29',
    )
  })

  it('chooseWeek takes any day in the week, and falls back to this week', () => {
    expect(chooseWeek('2026-11-01', NOW)).toBe(MONDAY)
    expect(chooseWeek('2026-11-02', NOW)).toBe(MONDAY + 7 * DAY_MS)
    for (const bad of [undefined, '', 'next', '2026-02-31', ['2026-11-02']]) {
      expect(chooseWeek(bad, NOW)).toBe(MONDAY)
    }
  })

  it('chooseWeek will not go further than two years either way', () => {
    expect(chooseWeek('2099-01-01', NOW)).toBe(MONDAY)
    expect(chooseWeek('1999-01-01', NOW)).toBe(MONDAY)
    const edge = MONDAY + MAX_WEEKS_AWAY * 7 * DAY_MS
    expect(chooseWeek(toIsoDay(edge), NOW)).toBe(edge)
    expect(chooseWeek(toIsoDay(edge + 7 * DAY_MS), NOW)).toBe(MONDAY)
    expect(weekAllowed(edge, NOW)).toBe(true)
    expect(weekAllowed(edge + 7 * DAY_MS, NOW)).toBe(false)
  })

  it('has seven days, Monday to Sunday', () => {
    const days = weekDays(MONDAY)
    expect(days.map((d) => d.weekday)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
    expect(days.map((d) => d.day)).toEqual([26, 27, 28, 29, 30, 31, 1])
    expect(days[0]?.iso).toBe('2026-10-26')
    expect(days[6]?.iso).toBe('2026-11-01')
  })

  it('bounds the query to exactly the week', () => {
    expect(weekBounds(MONDAY)).toEqual({
      from: '2026-10-26T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
    })
  })

  it('labels the week, with both years when it spans two', () => {
    expect(weekLabel(MONDAY)).toBe('Oct 26 – Nov 1, 2026')
    expect(weekLabel(Date.parse('2026-12-28T00:00:00Z'))).toBe(
      'Dec 28, 2026 – Jan 3, 2027',
    )
  })

  it('the current week has no week in its address', () => {
    expect(calendarHref(MONDAY, NOW)).toBe('/dashboard/calendar')
    expect(calendarHref(MONDAY + 7 * DAY_MS, NOW)).toBe(
      '/dashboard/calendar?week=2026-11-02',
    )
  })
})

describe('groupByDay', () => {
  const days = weekDays(MONDAY)
  const post = (scheduledFor: string, id = scheduledFor) => ({
    id,
    scheduledFor,
  })

  it('puts each post on its day, earliest first', () => {
    const grouped = groupByDay(
      [
        post('2026-10-28T15:30:00Z', 'late'),
        post('2026-10-28T09:30:00Z', 'early'),
        post('2026-10-26T10:00:00Z', 'monday'),
      ],
      days,
    )
    expect(grouped.get('2026-10-28')?.map((p) => p.id)).toEqual([
      'early',
      'late',
    ])
    expect(grouped.get('2026-10-26')?.map((p) => p.id)).toEqual(['monday'])
    expect(grouped.get('2026-10-27')).toEqual([])
    expect(grouped.size).toBe(7)
  })

  it('uses the UTC day, so a late evening post stays on its day', () => {
    const grouped = groupByDay([post('2026-10-28T23:59:00Z')], days)
    expect(grouped.get('2026-10-28')).toHaveLength(1)
    expect(grouped.get('2026-10-29')).toHaveLength(0)
  })

  it('leaves out a post outside the week or with a bad time', () => {
    const grouped = groupByDay(
      [
        post('2026-11-02T00:00:00Z'),
        post('2026-10-25T23:59:59Z'),
        post('nope'),
      ],
      days,
    )
    expect([...grouped.values()].flat()).toEqual([])
  })
})

describe('text', () => {
  it('formats a time of day in UTC', () => {
    expect(timeOfDay('2026-10-28T09:30:00Z')).toBe('9:30 AM')
    expect(timeOfDay('2026-10-28T15:05:00Z')).toBe('3:05 PM')
    expect(timeOfDay('nope')).toBe('')
  })

  it('shortens a card title to its first line', () => {
    expect(cardTitle('\n\n  Hello world \nsecond')).toBe('Hello world')
    expect(cardTitle('x'.repeat(200))).toHaveLength(48)
    expect(cardTitle('x'.repeat(200)).endsWith('…')).toBe(true)
    expect(cardTitle('')).toBe('')
  })
})

describe('todayIso', () => {
  it('is the UTC date', () => {
    expect(todayIso(Date.parse('2026-10-28T23:59:00Z'))).toBe('2026-10-28')
    expect(todayIso(Date.parse('2026-10-29T00:00:00Z'))).toBe('2026-10-29')
  })
})
