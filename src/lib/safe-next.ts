const MAX_LENGTH = 2048
// Control characters, including tab and newline, which browsers strip from
// URLs, so "/\t/evil.com" would otherwise become "//evil.com".
const CONTROL = /[\u0000-\u001f\u007f]/

// Returns `next` only if it is a same-origin path, otherwise `fallback`.
export function safeNext(
  next: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (typeof next !== 'string' || next.length === 0) return fallback
  if (next.length > MAX_LENGTH) return fallback
  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//')) return fallback
  if (next.includes('\\')) return fallback
  if (CONTROL.test(next)) return fallback

  // Belt and braces: it must still resolve to a path on the same origin.
  const base = 'http://shipnote.invalid'
  try {
    if (new URL(next, base).origin !== base) return fallback
  } catch {
    return fallback
  }
  return next
}
