import 'server-only'
import { createHash } from 'node:crypto'
import { rateLimit } from './rate-limit'

// Keys never hold a raw email: the address is lower-cased and hashed first.
export function emailKey(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

// Starting any sign-in (GitHub or email link): 20 per 15 minutes per IP.
export function allowSignInStart(ip: string) {
  return rateLimit('signInStartIp', ip)
}

// Asking for an email link: 5 per 15 minutes per IP and 3 per 15 minutes per
// email. Both are always checked, so neither can hide behind the other. The
// caller must not say which one was hit.
export async function allowEmailLink(ip: string, email: string) {
  const [byIp, byEmail] = await Promise.all([
    rateLimit('emailLinkIp', ip),
    rateLimit('emailLinkEmail', emailKey(email)),
  ])
  return byIp && byEmail
}
