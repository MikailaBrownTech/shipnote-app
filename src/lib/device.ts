import { createHmac } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'

// Everything stored about a sign-in is coarse on purpose: a truncated IP, a
// browser family from a fixed list, and a salted hash of the two.

export const BROWSER_FAMILIES = [
  'Edge',
  'Opera',
  'Firefox',
  'Chrome',
  'Safari',
  'Other',
] as const

export type BrowserFamily = (typeof BROWSER_FAMILIES)[number]

// Order matters: Edge and Opera also say "Chrome", and Chrome says "Safari".
export function userAgentFamily(userAgent: string | null): BrowserFamily {
  if (!userAgent) return 'Other'
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) return 'Edge'
  if (/\b(OPR|Opera)\//.test(userAgent)) return 'Opera'
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return 'Firefox'
  if (/\b(Chrome|CriOS)\//.test(userAgent)) return 'Chrome'
  if (/\bSafari\//.test(userAgent)) return 'Safari'
  return 'Other'
}

// Expands an IPv6 address to its eight 16-bit groups, or null if malformed.
function ipv6Groups(ip: string): number[] | null {
  const address = ip.split('%')[0] ?? ''
  const halves = address.split('::')
  if (halves.length > 2) return null

  const parse = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parse(halves[0] ?? '')
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : []

  // A trailing dotted IPv4 (::ffff:1.2.3.4) counts as two groups.
  const lastGroup = (tail.length > 0 ? tail : head).at(-1)
  if (lastGroup?.includes('.')) {
    const octets = lastGroup.split('.').map(Number)
    if (octets.length !== 4 || octets.some((o) => !(o >= 0 && o <= 255))) {
      return null
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets
    const converted = [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)]
    if (tail.length > 0) tail.splice(-1, 1, ...converted)
    else head.splice(-1, 1, ...converted)
  }

  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null

  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail].map(
    (group) => parseInt(group, 16),
  )
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null
}

// IPv4 becomes its /24, IPv6 its /48. Anything else (including the shared
// 'unknown' bucket) yields null, and no full address is ever returned.
export function ipPrefix(ip: string): string | null {
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split('.')
    return `${a}.${b}.${c}.0/24`
  }
  if (isIPv6(ip)) {
    const groups = ipv6Groups(ip)
    if (!groups) return null
    return `${groups
      .slice(0, 3)
      .map((group) => group.toString(16))
      .join(':')}::/48`
  }
  return null
}

// HMAC with a server-side salt, so the stored hash cannot be matched against a
// list of browsers and networks without the salt.
export function deviceHash(
  salt: string,
  family: BrowserFamily,
  prefix: string | null,
): string {
  return createHmac('sha256', salt)
    .update(`${family}|${prefix ?? 'none'}`)
    .digest('hex')
}
