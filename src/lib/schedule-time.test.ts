import { describe, expect, it } from 'vitest'
import {
  isTimeZone,
  MAX_LEAD_MS,
  MIN_LEAD_MS,
  parseScheduleTime,
} from './schedule-time'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const parse = (local: string, timeZone: string, nowMs = NOW) =>
  parseScheduleTime({ local, timeZone, nowMs })

describe('converting the picked time to UTC', () => {
  it('converts New York in winter (UTC-5)', () => {
    const r = parse('2026-11-10T09:30', 'America/New_York')
    expect(r.ok && r.utc.toISOString()).toBe('2026-11-10T14:30:00.000Z')
  })

  it('converts New York in summer (UTC-4) for a later date', () => {
    const r = parse(
      '2026-06-10T09:30',
      'America/New_York',
      Date.parse('2026-06-01T00:00:00Z'),
    )
    expect(r.ok && r.utc.toISOString()).toBe('2026-06-10T13:30:00.000Z')
  })

  it('converts a zone ahead of UTC', () => {
    const r = parse('2026-11-10T09:30', 'Asia/Tokyo')
    expect(r.ok && r.utc.toISOString()).toBe('2026-11-10T00:30:00.000Z')
  })

  it('converts a half-hour zone', () => {
    const r = parse('2026-11-10T09:30', 'Asia/Kolkata')
    expect(r.ok && r.utc.toISOString()).toBe('2026-11-10T04:00:00.000Z')
  })

  it('converts UTC itself', () => {
    const r = parse('2026-11-10T09:30', 'UTC')
    expect(r.ok && r.utc.toISOString()).toBe('2026-11-10T09:30:00.000Z')
  })

  it('uses the offset in force on the chosen day, across a clock change', () => {
    // Clocks in New York go back on 2026-11-01. 2026-11-04 is on the winter side.
    const r = parse(
      '2026-11-04T09:00',
      'America/New_York',
      Date.parse('2026-10-30T00:00:00Z'),
    )
    expect(r.ok && r.utc.toISOString()).toBe('2026-11-04T14:00:00.000Z')
    const before = parse(
      '2026-10-31T09:00',
      'America/New_York',
      Date.parse('2026-10-30T00:00:00Z'),
    )
    expect(before.ok && before.utc.toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    )
  })
})

describe('the allowed window', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString().slice(0, 16)

  it('refuses a time in the past or under 10 minutes ahead', () => {
    expect(parse('2026-11-02T11:00', 'UTC')).toEqual({
      ok: false,
      reason: 'too_soon',
    })
    expect(parse(at(MIN_LEAD_MS - 60_000), 'UTC')).toEqual({
      ok: false,
      reason: 'too_soon',
    })
  })

  it('accepts exactly 10 minutes ahead', () => {
    expect(parse(at(MIN_LEAD_MS), 'UTC').ok).toBe(true)
  })

  it('accepts up to 30 days ahead and refuses beyond', () => {
    expect(parse(at(MAX_LEAD_MS), 'UTC').ok).toBe(true)
    expect(parse(at(MAX_LEAD_MS + 60_000), 'UTC')).toEqual({
      ok: false,
      reason: 'too_far',
    })
  })

  it('judges the window in UTC, not in the local zone', () => {
    // 07:05 in New York on 2026-11-02 is 12:05 UTC: 5 minutes ahead.
    expect(parse('2026-11-02T07:05', 'America/New_York')).toEqual({
      ok: false,
      reason: 'too_soon',
    })
    expect(parse('2026-11-02T07:10', 'America/New_York').ok).toBe(true)
  })
})

describe('bad input', () => {
  it.each([
    '',
    '2026-11-10',
    '2026-11-10 09:30',
    '2026-11-10T09:30:00',
    '2026-11-10T09:30Z',
    '2026-02-31T09:30',
    '2026-13-10T09:30',
    '2026-11-10T25:00',
    '2026-11-10T09:61',
    'tomorrow',
    '2026-11-10T09:30\n',
    '0000-00-00T00:00',
  ])('refuses the local time %j', (local) => {
    expect(parse(local, 'UTC')).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([
    '',
    'Mars/Phobos',
    'America/New York',
    '../../etc',
    'UTC; drop',
    'x'.repeat(100),
  ])('refuses the time zone %j', (zone) => {
    expect(parse('2026-11-10T09:30', zone)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('knows real zones', () => {
    for (const zone of [
      'UTC',
      'Europe/London',
      'America/Los_Angeles',
      'Australia/Sydney',
    ]) {
      expect(isTimeZone(zone)).toBe(true)
    }
  })
})
