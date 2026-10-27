import { describe, expect, it } from 'vitest'
import { buildPrefill } from './repo-prefill'
import { countChars } from './project-schema'

const BOM = String.fromCharCode(0xfeff)

const base = {
  repoName: 'hello-world',
  description: 'My first repository',
  readme: '# Hello\n\nA readme.',
  readmeCut: false,
}

describe('buildPrefill', () => {
  it('fills the name, summary, stage and notes from the repo', () => {
    expect(buildPrefill(base)).toEqual({
      name: 'hello-world',
      summary: 'My first repository',
      stage: 'in_progress',
      notes: '# Hello\n\nA readme.',
      truncated: false,
      hasReadme: true,
    })
  })

  it('always starts at in_progress', () => {
    expect(buildPrefill(base).stage).toBe('in_progress')
  })

  describe('name', () => {
    it('is trimmed and cut to 80 characters', () => {
      const long = 'n'.repeat(120)
      expect(buildPrefill({ ...base, repoName: `  ${long}  ` }).name).toBe(
        'n'.repeat(80),
      )
    })

    it('is cut by characters, not UTF-16 units', () => {
      const name = buildPrefill({
        ...base,
        repoName: '\u{1F680}'.repeat(100),
      }).name
      expect(countChars(name)).toBe(80)
      expect(name).not.toContain(String.fromCharCode(0xfffd))
    })
  })

  describe('summary', () => {
    it('is cut to 300 characters', () => {
      const summary = buildPrefill({
        ...base,
        description: 'd'.repeat(500),
      }).summary
      expect(summary).toBe('d'.repeat(300))
    })

    it('collapses line breaks and runs of spaces into one line', () => {
      expect(
        buildPrefill({ ...base, description: '  one\n\ntwo \t three  ' })
          .summary,
      ).toBe('one two three')
    })

    it('is empty when the repository has no description', () => {
      expect(buildPrefill({ ...base, description: null }).summary).toBe('')
      expect(buildPrefill({ ...base, description: '   ' }).summary).toBe('')
    })
  })

  describe('notes (the README)', () => {
    it('is cut to 12,000 characters and says it was cut', () => {
      const result = buildPrefill({ ...base, readme: 'r'.repeat(15_000) })
      expect(countChars(result.notes)).toBe(12_000)
      expect(result.truncated).toBe(true)
    })

    it('is not marked cut at exactly 12,000', () => {
      const result = buildPrefill({ ...base, readme: 'r'.repeat(12_000) })
      expect(countChars(result.notes)).toBe(12_000)
      expect(result.truncated).toBe(false)
    })

    it('is marked cut at 12,001', () => {
      expect(
        buildPrefill({ ...base, readme: 'r'.repeat(12_001) }).truncated,
      ).toBe(true)
    })

    it('is marked cut when it was cut while being read, even if what is left is short', () => {
      const result = buildPrefill({ ...base, readme: 'short', readmeCut: true })
      expect(result.truncated).toBe(true)
    })

    it('counts characters, not UTF-16 units', () => {
      const exactly = buildPrefill({
        ...base,
        readme: '\u{1F680}'.repeat(12_000),
      })
      expect(exactly.truncated).toBe(false)
      expect(countChars(exactly.notes)).toBe(12_000)
      const over = buildPrefill({ ...base, readme: '\u{1F680}'.repeat(12_500) })
      expect(over.truncated).toBe(true)
      expect(countChars(over.notes)).toBe(12_000)
    })

    it('stores line breaks as LF, drops NUL and a byte order mark', () => {
      const result = buildPrefill({ ...base, readme: BOM + 'a\r\nb\rc\u0000d' })
      expect(result.notes).toBe('a\nb\ncd')
    })

    it('has no README: empty notes, hasReadme false, not truncated', () => {
      const result = buildPrefill({ ...base, readme: null })
      expect(result).toMatchObject({
        notes: '',
        hasReadme: false,
        truncated: false,
      })
    })

    it('an empty README file is a README with empty notes', () => {
      const result = buildPrefill({ ...base, readme: '' })
      expect(result).toMatchObject({ notes: '', hasReadme: true })
    })

    it('keeps markup as plain text for the page to escape', () => {
      expect(
        buildPrefill({ ...base, readme: '<script>alert(1)</script>' }).notes,
      ).toBe('<script>alert(1)</script>')
    })
  })
})
