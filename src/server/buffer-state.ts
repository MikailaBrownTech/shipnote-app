import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { sessionCookieOptions } from '@/lib/cookie-options'
import { getSchedulingEnv } from './env'
import { openToken, sealToken, VaultError } from './token-vault'

// Protects the Buffer connect flow against a forged or replayed callback, and
// holds the PKCE code verifier until the callback needs it.
//
// When the person starts connecting, the server sets a short-lived cookie. Its
// contents are SEALED (AES-256-GCM, the user id as additional authenticated
// data), not just signed, because they include the PKCE code verifier. The
// cookie is HttpOnly, secure, expires in 10 minutes, is limited to the callback
// path, and is cleared the moment the callback reads it, so it works once.
//
// It holds a random state (also sent to Buffer, which must send it back), the
// expiry, the code verifier, and the ids of the project and draft the person
// started from, if any. No path and no text: the callback builds the redirect
// itself and re-checks that the project and draft are the user's.

export const BUFFER_STATE_COOKIE = 'sn_buf_state'
export const BUFFER_STATE_PATH = '/dashboard/buffer'
export const STATE_TTL_MS = 10 * 60 * 1000

type Payload = {
  n: string // state
  e: number // expiry, ms
  v: string // PKCE code verifier
  p: string // project id or ''
  d: string // draft id or ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReturnTo = { projectId: string; draftId: string | null } | null

// RFC 7636: a random verifier of 43 to 128 characters, and its SHA-256 hash.
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(input: {
  userId: string
  key: Buffer
  verifier: string
  returnTo: ReturnTo
  nowMs?: number
}): { state: string; cookieValue: string } {
  const state = randomBytes(24).toString('base64url')
  const body: Payload = {
    n: state,
    e: (input.nowMs ?? Date.now()) + STATE_TTL_MS,
    v: input.verifier,
    p: input.returnTo?.projectId ?? '',
    d: input.returnTo?.draftId ?? '',
  }
  return {
    state,
    cookieValue: sealToken({
      plaintext: JSON.stringify(body),
      userId: input.userId,
      key: input.key,
    }),
  }
}

export type StateCheck =
  { ok: true; verifier: string; returnTo: ReturnTo } | { ok: false }

export function verifyState(input: {
  cookieValue: string | undefined
  userId: string
  key: Buffer
  // The `state` Buffer sent back. Required.
  returnedState: string | null
  nowMs?: number
}): StateCheck {
  const bad = { ok: false } as const
  const { cookieValue, returnedState } = input
  if (!cookieValue || cookieValue.length > 2000) return bad
  if (!returnedState || returnedState.length > 200) return bad

  let parsed: Partial<Payload>
  try {
    parsed = JSON.parse(
      openToken({ sealed: cookieValue, userId: input.userId, key: input.key }),
    ) as Partial<Payload>
  } catch (error) {
    if (error instanceof VaultError || error instanceof SyntaxError) return bad
    throw error
  }
  if (
    typeof parsed.n !== 'string' ||
    typeof parsed.e !== 'number' ||
    typeof parsed.v !== 'string' ||
    typeof parsed.p !== 'string' ||
    typeof parsed.d !== 'string'
  ) {
    return bad
  }
  if ((input.nowMs ?? Date.now()) > parsed.e) return bad
  if (parsed.n.length === 0 || parsed.n !== returnedState) return bad
  if (parsed.v.length < 43 || parsed.v.length > 128) return bad
  if (parsed.p !== '' && !UUID.test(parsed.p)) return bad
  if (parsed.d !== '' && !UUID.test(parsed.d)) return bad
  if (parsed.d !== '' && parsed.p === '') return bad
  return {
    ok: true,
    verifier: parsed.v,
    returnTo:
      parsed.p === ''
        ? null
        : { projectId: parsed.p, draftId: parsed.d === '' ? null : parsed.d },
  }
}

function cookieOptions() {
  return { ...sessionCookieOptions(), path: BUFFER_STATE_PATH }
}

// Sets the state cookie and returns what goes on the authorization URL.
export async function startState(
  userId: string,
  returnTo: ReturnTo,
): Promise<{ state: string; challenge: string }> {
  const settings = getSchedulingEnv()
  const current = settings?.keys[0]
  if (!current) throw new Error('Scheduling is not enabled')
  const { verifier, challenge } = newPkce()
  const { state, cookieValue } = createState({
    userId,
    key: current.key,
    verifier,
    returnTo,
  })
  const store = await cookies()
  store.set(BUFFER_STATE_COOKIE, cookieValue, {
    ...cookieOptions(),
    maxAge: STATE_TTL_MS / 1000,
  })
  return { state, challenge }
}

// Reads and clears the cookie in one step, so it can only be used once.
export async function consumeState(input: {
  userId: string
  returnedState: string | null
}): Promise<StateCheck> {
  const settings = getSchedulingEnv()
  const current = settings?.keys[0]
  if (!current) return { ok: false }
  const store = await cookies()
  const cookieValue = store.get(BUFFER_STATE_COOKIE)?.value
  store.set(BUFFER_STATE_COOKIE, '', {
    ...cookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  })
  return verifyState({
    cookieValue,
    userId: input.userId,
    key: current.key,
    returnedState: input.returnedState,
  })
}
