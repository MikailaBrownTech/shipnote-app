import 'server-only'
import { isIP } from 'node:net'
import { headers } from 'next/headers'

export const UNKNOWN_IP = 'unknown'

// Vercel sets x-vercel-forwarded-for itself and overwrites any value the
// client sends. It is the only header trusted here: x-forwarded-for is also
// overwritten on Vercel, but is not safe on other hosts, and an attacker who
// can set the header could otherwise pick any rate-limit bucket.
//
// Off Vercel (for example local dev) no header is trusted, so everything
// shares the 'unknown' bucket. That is deliberate: it fails towards limiting,
// never towards a spoofable key.
export async function getClientIp(): Promise<string> {
  const value = (await headers()).get('x-vercel-forwarded-for')
  const first = value?.split(',')[0]?.trim()
  return first && isIP(first) ? first : UNKNOWN_IP
}
