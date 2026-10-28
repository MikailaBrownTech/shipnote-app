import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// Checks that a request really came from GitHub (the webhook) or from QStash
// (the worker callback), before anything in it is parsed or acted on.
//
// Both use the raw bytes of the body exactly as received. Comparisons are
// constant time. Nothing here logs, and a failure says nothing about why.

// ---- GitHub: X-Hub-Signature-256 ----
//
// "sha256=" followed by the hex HMAC-SHA256 of the raw body, keyed with the
// webhook secret. The older SHA-1 header is never accepted.

const GITHUB_HEADER = /^sha256=([0-9a-f]{64})$/

// Whether the header has the right shape. A request without it is refused
// before any work, including computing the HMAC.
export function isWellFormedGithubSignature(header: string | null): boolean {
  return header !== null && GITHUB_HEADER.test(header)
}

export function verifyGithubSignature(input: {
  header: string | null
  rawBody: Buffer
  secret: string
}): boolean {
  const match = input.header ? GITHUB_HEADER.exec(input.header) : null
  if (!match?.[1]) return false
  const given = Buffer.from(match[1], 'hex')
  const expected = createHmac('sha256', input.secret)
    .update(input.rawBody)
    .digest()
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// ---- QStash: Upstash-Signature ----
//
// A JWT (HS256) signed with the current or the next signing key. Its claims
// must say: iss "Upstash"; sub the URL that was called; exp not passed; nbf
// reached; body the SHA-256 of the raw body, base64url encoded.

const MAX_TOKEN_CHARS = 4096
const CLOCK_SKEW_SECONDS = 5

const b64urlDecode = (value: string): Buffer | null =>
  /^[A-Za-z0-9_-]*$/.test(value) ? Buffer.from(value, 'base64url') : null

// Upstash's docs describe the body claim as base64 with the URL-safe alphabet,
// and their example keeps the "=" padding. Accept it with or without padding,
// and in either alphabet, by comparing the normalised form.
const normalise = (value: string) =>
  value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function verifyQstashSignature(input: {
  signature: string | null
  rawBody: Buffer
  // The exact URL QStash was asked to call.
  url: string
  keys: readonly string[]
  nowMs?: number
}): boolean {
  const { signature } = input
  if (!signature || signature.length > MAX_TOKEN_CHARS) return false
  const parts = signature.split('.')
  if (parts.length !== 3) return false
  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) return false

  const headerBytes = b64urlDecode(headerPart)
  const payloadBytes = b64urlDecode(payloadPart)
  const given = b64urlDecode(signaturePart)
  if (!headerBytes || !payloadBytes || !given) return false

  let header: unknown
  let claims: unknown
  try {
    header = JSON.parse(headerBytes.toString('utf8'))
    claims = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    return false
  }
  // Only HS256. Never "none", never an algorithm the token chooses.
  if (typeof header !== 'object' || header === null) return false
  if ((header as { alg?: unknown }).alg !== 'HS256') return false
  if (typeof claims !== 'object' || claims === null) return false

  // The signature, against every key (no early exit on a match).
  const signedPart = `${headerPart}.${payloadPart}`
  let signedByAKey = false
  for (const key of input.keys) {
    const expected = createHmac('sha256', key).update(signedPart).digest()
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      signedByAKey = true
    }
  }
  if (!signedByAKey) return false

  // The claims are only read once the signature holds.
  const { iss, sub, exp, nbf, body } = claims as Record<string, unknown>
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000)
  if (iss !== 'Upstash') return false
  if (sub !== input.url) return false
  if (typeof exp !== 'number' || !(exp > now)) return false
  if (typeof nbf !== 'number' || nbf > now + CLOCK_SKEW_SECONDS) return false
  if (typeof body !== 'string') return false

  const actual = Buffer.from(
    createHash('sha256').update(input.rawBody).digest('base64url'),
  )
  const claimed = Buffer.from(normalise(body))
  return actual.length === claimed.length && timingSafeEqual(actual, claimed)
}
