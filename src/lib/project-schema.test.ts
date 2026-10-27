import { describe, expect, it } from 'vitest'
import {
  countChars,
  FIELD_MESSAGES,
  parseProjectForm,
  projectId,
  PROJECT_LIMITS,
} from './project-schema'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const valid = { name: 'Shipnote', summary: '', stage: 'idea', notes: '' }

describe('parseProjectForm', () => {
  it('accepts a valid project and trims the text', () => {
    const parsed = parseProjectForm(
      form({
        name: '  Shipnote  ',
        summary: ' hi ',
        stage: 'shipped',
        notes: '  n  ',
      }),
    )
    expect(parsed).toEqual({
      ok: true,
      data: { name: 'Shipnote', summary: 'hi', stage: 'shipped', notes: 'n' },
    })
  })

  it('turns an empty or missing summary into null', () => {
    const empty = parseProjectForm(form(valid))
    expect(empty.ok && empty.data.summary).toBeNull()
    const missing = parseProjectForm(
      form({ name: 'Shipnote', stage: 'idea', notes: '' }),
    )
    expect(missing.ok && missing.data.summary).toBeNull()
  })

  it('ignores the fields Next adds to a Server Action form', () => {
    const data = form(valid)
    data.set('$ACTION_ID_abc', '')
    data.set('$ACTION_REF_1', '')
    expect(parseProjectForm(data).ok).toBe(true)
  })

  it('rejects unknown fields, such as an attempt to set user_id', () => {
    const parsed = parseProjectForm(
      form({ ...valid, user_id: '00000000-0000-4000-8000-000000000001' }),
    )
    expect(parsed.ok).toBe(false)
  })

  it.each([
    ['an empty name', { name: '' }, 'name'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a name over 80', { name: 'x'.repeat(81) }, 'name'],
    ['a summary over 300', { summary: 'x'.repeat(301) }, 'summary'],
    ['notes over 12,000', { notes: 'x'.repeat(12_001) }, 'notes'],
    ['an unknown stage', { stage: 'launched' }, 'stage'],
    ['a missing stage', { stage: '' }, 'stage'],
    ['a NUL character', { notes: 'a\u0000b' }, 'notes'],
  ] as const)('rejects %s with a fixed message', (_label, change, field) => {
    const parsed = parseProjectForm(form({ ...valid, ...change }))
    expect(parsed).toEqual({
      ok: false,
      errors: { [field]: FIELD_MESSAGES[field] },
    })
  })

  it('accepts text exactly at each limit', () => {
    const parsed = parseProjectForm(
      form({
        name: 'x'.repeat(80),
        summary: 'x'.repeat(300),
        stage: 'idea',
        notes: 'x'.repeat(12_000),
      }),
    )
    expect(parsed.ok).toBe(true)
  })

  it('counts characters like the database, not UTF-16 units', () => {
    const emoji = '\u{1F680}'.repeat(12_000)
    expect(emoji.length).toBe(24_000)
    expect(countChars(emoji)).toBe(12_000)
    expect(parseProjectForm(form({ ...valid, notes: emoji })).ok).toBe(true)
    expect(
      parseProjectForm(form({ ...valid, notes: '\u{1F680}'.repeat(12_001) }))
        .ok,
    ).toBe(false)
  })

  it('stores line breaks as LF so the browser CRLF does not inflate the count', () => {
    // 6000 characters and 5999 line breaks: 17,998 units as CRLF.
    const lines = Array.from({ length: 6000 }, () => 'a').join('\r\n')
    const parsed = parseProjectForm(form({ ...valid, notes: lines }))
    expect(parsed.ok && parsed.data.notes.includes('\r')).toBe(false)
    expect(parsed.ok).toBe(true)
  })

  it('never puts what was typed into an error message', () => {
    const secret = 'my-secret-project-notes'
    const parsed = parseProjectForm(
      form({ ...valid, stage: 'nope', notes: secret + 'x'.repeat(12_000) }),
    )
    expect(JSON.stringify(parsed)).not.toContain(secret)
  })

  it('exposes the limits the database enforces', () => {
    expect(PROJECT_LIMITS).toEqual({
      name: 80,
      summary: 300,
      notes: 12_000,
      perUser: 5,
    })
  })
})

describe('projectId', () => {
  it('accepts a UUID and nothing else', () => {
    expect(
      projectId.safeParse('6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01').success,
    ).toBe(true)
    for (const bad of ['', 'abc', '1', "1' or '1'='1", '../../etc', 'null']) {
      expect(projectId.safeParse(bad).success).toBe(false)
    }
  })
})
