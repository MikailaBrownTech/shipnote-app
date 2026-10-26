import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext', () => {
  it('keeps a local path, with query and hash', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
    expect(safeNext('/dashboard?tab=1#top')).toBe('/dashboard?tab=1#top')
    expect(safeNext('/')).toBe('/')
  })

  it('falls back when empty or missing', () => {
    expect(safeNext('')).toBe('/dashboard')
    expect(safeNext(null)).toBe('/dashboard')
    expect(safeNext(undefined)).toBe('/dashboard')
  })

  it('uses a custom fallback', () => {
    expect(safeNext('//evil.com', '/')).toBe('/')
  })

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative path', '//evil.com/dashboard'],
    ['backslash after slash', '/\\evil.com'],
    ['backslash anywhere', '/ok\\evil.com'],
    ['https URL', 'https://evil.com'],
    ['http URL', 'http://evil.com/dashboard'],
    ['javascript URL', 'javascript:alert(1)'],
    ['no leading slash', 'dashboard'],
    ['tab hiding a second slash', '/\t/evil.com'],
    ['newline', '/dashboard\nSet-Cookie: x=1'],
    ['carriage return', '/dashboard\r'],
    ['null byte', '/dash\u0000board'],
    ['delete character', '/dash\u007fboard'],
    ['very long', '/' + 'a'.repeat(3000)],
  ])('rejects %s', (_label, input) => {
    expect(safeNext(input)).toBe('/dashboard')
  })
})
