import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  MAX_DAYS_AWAY,
  calendarHref,
  cardTitle,
  chooseAnchor,
  choosePostId,
  chooseView,
  dayAllowed,
  groupByDay,
  mondayOf,
  monthStart,
  monthWeeks,
  parseDay,
  periodLabel,
  rangeFor,
  samePeriod,
  shiftAnchor,
  timeOfDay,
  todayIso,
  toIsoDay,
  weekDays,
} from './calendar'

// Wednesday 28 October 2026, so the week is Monday 26 Oct to Sunday 1 Nov.
const NOW = Date.parse('2026-10-28T12:00:00Z')
const TODAY = Date.parse('2026-10-28T00:00:00Z')
const MONDAY = Date.parse('2026-10-26T00:00:00Z')
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

describe('reading the address', () => {
  it('takes a view only from the fixed list', () => {
    expect(chooseView('month')).toBe('month')
    for (const bad of [undefined, '', 'week', 'MONTH', 'year', ['month'], 3]) {
      expect(chooseView(bad)).toBe('week')
    }
  })

  it('takes a post only in the shape of an id', () => {
    const id = 'aaaaaaaa-2222-4333-8444-555555555555'
    expect(choosePostId(id)).toBe(id)
    for (const bad of [
      undefined,
      '',
      id.toUpperCase(),
      `${id}x`,
      '../x',
      "'; drop",
      [id],
    ]) {
      expect(choosePostId(bad)).toBeNull()
    }
  })

  it('reads a real date as the UTC midnight it starts', () => {
    expect(parseDay('2026-10-26')).toBe(MONDAY)
    expect(parseDay('2028-02-29')).toBe(day('2028-02-29'))
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
  ])('refuses the date %j', (bad) => {
    expect(parseDay(bad)).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    for (const bad of [undefined, null, 20261026, ['2026-10-26'], {}]) {
      expect(parseDay(bad)).toBeNull()
    }
  })

  it('the anchor is the date from the address, or today', () => {
    expect(chooseAnchor('2026-11-04', NOW)).toBe(day('2026-11-04'))
    for (const bad of [undefined, '', 'next', '2026-02-31', ['2026-11-04']]) {
      expect(chooseAnchor(bad, NOW)).toBe(TODAY)
    }
  })

  it('the anchor will not be more than two years from today', () => {
    expect(chooseAnchor('2099-01-01', NOW)).toBe(TODAY)
    expect(chooseAnchor('1999-01-01', NOW)).toBe(TODAY)
    const edge = TODAY + MAX_DAYS_AWAY * DAY_MS
    expect(chooseAnchor(toIsoDay(edge), NOW)).toBe(edge)
    expect(chooseAnchor(toIsoDay(edge + DAY_MS), NOW)).toBe(TODAY)
    expect(dayAllowed(edge, NOW)).toBe(true)
    expect(dayAllowed(edge + DAY_MS, NOW)).toBe(false)
  })
})

describe('weeks', () => {
  it('a week starts on Monday, whichever day is asked for', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(mondayOf(MONDAY + i * DAY_MS + 5 * 3_600_000)).toBe(MONDAY)
    }
    expect(mondayOf(MONDAY + 7 * DAY_MS)).toBe(MONDAY + 7 * DAY_MS)
  })

  it('crosses a year end correctly', () => {
    expect(toIsoDay(mondayOf(day('2026-01-01')))).toBe('2025-12-29')
  })

  it('has seven days, Monday to Sunday, for any day in the week', () => {
    for (const anchor of [MONDAY, TODAY, day('2026-11-01')]) {
      const days = weekDays(anchor)
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
    }
  })

  it('bounds the query to exactly the week', () => {
    expect(rangeFor('week', TODAY)).toEqual({
      from: '2026-10-26T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
    })
  })

  it('labels the week, with both years when it spans two', () => {
    expect(periodLabel('week', TODAY)).toBe('Oct 26 – Nov 1, 2026')
    expect(periodLabel('week', day('2026-12-30'))).toBe(
      'Dec 28, 2026 – Jan 3, 2027',
    )
  })

  it('moves a week at a time', () => {
    expect(toIsoDay(shiftAnchor('week', TODAY, 1))).toBe('2026-11-04')
    expect(toIsoDay(shiftAnchor('week', TODAY, -1))).toBe('2026-10-21')
  })
})

describe('months', () => {
  it('a month is the weeks from the one with the 1st to the one with the last day', () => {
    const october = monthWeeks(TODAY)
    expect(october).toHaveLength(5)
    expect(october[0]?.[0]?.iso).toBe('2026-09-28')
    expect(october.at(-1)?.[6]?.iso).toBe('2026-11-01')
    // Six rows when the month needs them.
    const november = monthWeeks(day('2026-11-15'))
    expect(november).toHaveLength(6)
    expect(november[0]?.[0]?.iso).toBe('2026-10-26')
    expect(november.at(-1)?.[0]?.iso).toBe('2026-11-30')
    // Four rows for a February that starts on a Monday.
    expect(monthWeeks(day('2027-02-10'))).toHaveLength(4)
  })

  it('every row is seven days, in order, with no gaps', () => {
    for (const anchor of [
      TODAY,
      day('2026-11-15'),
      day('2027-02-10'),
      day('2028-02-29'),
    ]) {
      const days = monthWeeks(anchor).flat()
      expect(days.length % 7).toBe(0)
      for (let i = 1; i < days.length; i += 1) {
        expect(day(days[i]?.iso ?? '') - day(days[i - 1]?.iso ?? '')).toBe(
          DAY_MS,
        )
      }
    }
  })

  it('marks the days that belong to the month shown', () => {
    const days = monthWeeks(TODAY).flat()
    expect(days.filter((d) => d.inMonth)).toHaveLength(31)
    expect(days.find((d) => d.iso === '2026-09-30')?.inMonth).toBe(false)
    expect(days.find((d) => d.iso === '2026-10-01')?.inMonth).toBe(true)
    expect(days.find((d) => d.iso === '2026-11-01')?.inMonth).toBe(false)
  })

  it('bounds the query to the whole grid', () => {
    expect(rangeFor('month', TODAY)).toEqual({
      from: '2026-09-28T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
    })
    expect(rangeFor('month', day('2026-11-15'))).toEqual({
      from: '2026-10-26T00:00:00.000Z',
      to: '2026-12-07T00:00:00.000Z',
    })
  })

  it('labels the month', () => {
    expect(periodLabel('month', TODAY)).toBe('October 2026')
    expect(periodLabel('month', day('2027-01-31'))).toBe('January 2027')
  })

  it('moves a month at a time, to its first day, across a year end', () => {
    expect(toIsoDay(shiftAnchor('month', TODAY, 1))).toBe('2026-11-01')
    expect(toIsoDay(shiftAnchor('month', TODAY, -1))).toBe('2026-09-01')
    expect(toIsoDay(shiftAnchor('month', day('2026-12-15'), 1))).toBe(
      '2027-01-01',
    )
    expect(toIsoDay(shiftAnchor('month', day('2026-01-15'), -1))).toBe(
      '2025-12-01',
    )
    // The 31st never skips a short month.
    expect(toIsoDay(shiftAnchor('month', day('2026-01-31'), 1))).toBe(
      '2026-02-01',
    )
    expect(monthStart(day('2026-10-28'))).toBe(day('2026-10-01'))
  })

  it('knows whether two days show the same week or month', () => {
    expect(samePeriod('week', TODAY, MONDAY)).toBe(true)
    expect(samePeriod('week', TODAY, MONDAY + 7 * DAY_MS)).toBe(false)
    expect(samePeriod('month', TODAY, day('2026-10-01'))).toBe(true)
    expect(samePeriod('month', TODAY, day('2026-11-01'))).toBe(false)
  })
})

describe('calendarHref', () => {
  it('leaves out what matches the defaults', () => {
    expect(calendarHref({ view: 'week', anchor: TODAY }, NOW)).toBe(
      '/dashboard/calendar',
    )
    expect(calendarHref({ view: 'week', anchor: MONDAY }, NOW)).toBe(
      '/dashboard/calendar',
    )
    expect(calendarHref({ view: 'month', anchor: TODAY }, NOW)).toBe(
      '/dashboard/calendar?view=month',
    )
  })

  it('names the date when it is outside the period that holds today', () => {
    expect(calendarHref({ view: 'week', anchor: day('2026-11-04') }, NOW)).toBe(
      '/dashboard/calendar?date=2026-11-04',
    )
    expect(
      calendarHref({ view: 'month', anchor: day('2026-11-01') }, NOW),
    ).toBe('/dashboard/calendar?view=month&date=2026-11-01')
  })

  it('keeps a chosen post', () => {
    const id = 'aaaaaaaa-2222-4333-8444-555555555555'
    expect(calendarHref({ view: 'month', anchor: TODAY, post: id }, NOW)).toBe(
      `/dashboard/calendar?view=month&post=${id}`,
    )
    expect(calendarHref({ view: 'week', anchor: TODAY, post: null }, NOW)).toBe(
      '/dashboard/calendar',
    )
  })
})

describe('groupByDay', () => {
  const days = weekDays(TODAY)
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

  it('works across a whole month grid, including the neighbouring months’ days', () => {
    const grid = monthWeeks(TODAY).flat()
    const grouped = groupByDay(
      [
        post('2026-09-30T10:00:00Z', 'prev'),
        post('2026-11-01T10:00:00Z', 'next'),
      ],
      grid,
    )
    expect(grouped.size).toBe(35)
    expect(grouped.get('2026-09-30')).toHaveLength(1)
    expect(grouped.get('2026-11-01')).toHaveLength(1)
  })

  it('uses the UTC day, so a late evening post stays on its day', () => {
    const grouped = groupByDay([post('2026-10-28T23:59:00Z')], days)
    expect(grouped.get('2026-10-28')).toHaveLength(1)
    expect(grouped.get('2026-10-29')).toHaveLength(0)
  })

  it('leaves out a post outside the days or with a bad time', () => {
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

  it('todayIso is the UTC date', () => {
    expect(todayIso(Date.parse('2026-10-28T23:59:00Z'))).toBe('2026-10-28')
    expect(todayIso(Date.parse('2026-10-29T00:00:00Z'))).toBe('2026-10-29')
  })
})
