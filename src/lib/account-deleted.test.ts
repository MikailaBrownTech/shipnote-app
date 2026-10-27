import { describe, expect, it } from 'vitest'
import { parseDeletedNotes } from './account-deleted'

describe('parseDeletedNotes', () => {
  it('reads buffer=1 and a count of 1 to 999', () => {
    expect(parseDeletedNotes({ buffer: '1', left: '3' })).toEqual({
      buffer: true,
      left: 3,
    })
    expect(parseDeletedNotes({ left: '999' })).toEqual({
      buffer: false,
      left: 999,
    })
    expect(parseDeletedNotes({})).toEqual({ buffer: false, left: 0 })
  })

  it.each([
    '',
    '0',
    '00',
    '01',
    '1000',
    '-1',
    '1.5',
    ' 3',
    '3 ',
    '<b>',
    'NaN',
    '1e3',
  ])('ignores a count of %j', (left) => {
    expect(parseDeletedNotes({ left }).left).toBe(0)
  })

  it.each(['', '0', 'true', 'yes', '11', ' 1'])(
    'ignores buffer=%j',
    (buffer) => {
      expect(parseDeletedNotes({ buffer }).buffer).toBe(false)
    },
  )

  it('ignores repeated or non-text values', () => {
    expect(parseDeletedNotes({ buffer: ['1'], left: ['3'] })).toEqual({
      buffer: false,
      left: 0,
    })
    expect(parseDeletedNotes({ buffer: 1, left: 3 })).toEqual({
      buffer: false,
      left: 0,
    })
    expect(parseDeletedNotes({ buffer: null, left: undefined })).toEqual({
      buffer: false,
      left: 0,
    })
  })
})
