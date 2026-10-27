import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { sessionCookieOptions } from '@/lib/cookie-options'
import { getGithubEnv } from './env'

// Protects the connect flow against a forged callback. When the person starts
// connecting, the server sets a short-lived cookie that is signed (HMAC), bound
// to their user id, and expires in 10 minutes. The callback accepts only a
// request that arrives with that cookie.
//
// The only thing it carries besides that is the id of the project the person
// started from, if any, so they can be sent back to it. It holds no path and no
// text: the callback builds the redirect itself and re-checks that the project
// is the user's.
//
// GitHub's docs say the `state` parameter is not returned when the OAuth step
// happens during installation, so the cookie is the check. If a state value
// does come back it must match too.

export const GITHUB_STATE_COOKIE = 'sn_gh_state'
// The cookie is only ever needed by the callback.
export const GITHUB_STATE_PATH = '/dashboard/github'
export const STATE_TTL_MS = 10 * 60 * 1000

// x is a project id, or '' when the person started from the dashboard.
type Payload = { n: string; e: number; u: string; x: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url')

function sign(payload: string, secret: string) {
  return createHmac('sha256', `shipnote:github-state:${secret}`)
    .update(payload)
    .digest()
}

export function createState(input: {
  userId: string
  projectId: string | null
  secret: string
  nowMs?: number
}): { nonce: string; cookieValue: string } {
  const nonce = randomBytes(24).toString('base64url')
  const body: Payload = {
    n: nonce,
    e: (input.nowMs ?? Date.now()) + STATE_TTL_MS,
    u: input.userId,
    x: input.projectId ?? '',
  }
  const payload = b64(JSON.stringify(body))
  return {
    nonce,
    cookieValue: `${payload}.${b64(sign(payload, input.secret))}`,
  }
}

export type StateCheck = { ok: true; projectId: string | null } | { ok: false }

function equal(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b)
}

export function verifyState(input: {
  cookieValue: string | undefined
  userId: string
  secret: string
  // The `state` GitHub sent back, if it sent one.
  returnedState?: string | null
  nowMs?: number
}): StateCheck {
  const bad = { ok: false } as const
  const { cookieValue } = input
  if (!cookieValue || cookieValue.length > 2000) return bad

  const parts = cookieValue.split('.')
  if (parts.length !== 2) return bad
  const [payload, signature] = parts
  if (!payload || !signature) return bad
  if (
    !equal(Buffer.from(signature, 'base64url'), sign(payload, input.secret))
  ) {
    return bad
  }

  let parsed: Partial<Payload>
  try {
    parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as Partial<Payload>
  } catch {
    return bad
  }
  if (
    typeof parsed.n !== 'string' ||
    typeof parsed.e !== 'number' ||
    typeof parsed.u !== 'string' ||
    typeof parsed.x !== 'string'
  ) {
    return bad
  }
  if (parsed.x !== '' && !UUID.test(parsed.x)) return bad
  if (parsed.u !== input.userId) return bad
  if ((input.nowMs ?? Date.now()) > parsed.e) return bad

  if (input.returnedState) {
    if (!equal(Buffer.from(input.returnedState), Buffer.from(parsed.n))) {
      return bad
    }
  }
  return { ok: true, projectId: parsed.x === '' ? null : parsed.x }
}

function cookieOptions() {
  return { ...sessionCookieOptions(), path: GITHUB_STATE_PATH }
}

// Sets the state cookie and returns the nonce to put on the install URL.
export async function startState(
  userId: string,
  projectId: string | null,
): Promise<string> {
  const settings = getGithubEnv()
  if (!settings) throw new Error('GitHub is not enabled')
  const { nonce, cookieValue } = createState({
    userId,
    projectId,
    secret: settings.clientSecret,
  })
  const store = await cookies()
  store.set(GITHUB_STATE_COOKIE, cookieValue, {
    ...cookieOptions(),
    maxAge: STATE_TTL_MS / 1000,
  })
  return nonce
}

// Reads and clears the cookie in one step, so it can only be used once.
export async function consumeState(input: {
  userId: string
  returnedState: string | null
}): Promise<StateCheck> {
  const settings = getGithubEnv()
  if (!settings) return { ok: false }
  const store = await cookies()
  const cookieValue = store.get(GITHUB_STATE_COOKIE)?.value
  store.set(GITHUB_STATE_COOKIE, '', {
    ...cookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  })
  return verifyState({
    cookieValue,
    userId: input.userId,
    secret: settings.clientSecret,
    returnedState: input.returnedState,
  })
}
