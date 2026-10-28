import 'server-only'
import { redirect } from 'next/navigation'
import { lastSignInAt } from '@/lib/auth-claims'
import { createClient } from '@/lib/supabase/server'
import { sessionStillActive } from '@/server/session-check'

export type CurrentUser = {
  id: string
  email: string | null
  // Unix seconds of the last real sign-in, or null if it cannot be told.
  signedInAt: number | null
}

// Two checks, because each alone is not enough:
//
// 1. getClaims() verifies the token's signature and expiry. That proves the
//    token is genuine, but it is a local check: it keeps passing after the
//    session was revoked (sign out everywhere, account deletion) until the
//    access token expires. getSession() is never used to identify a user.
// 2. The token's session_id must still exist in auth.sessions, and the account
//    must not be deleted. This is the check Supabase documents for revoked
//    sessions. It costs one round trip per call and fails closed.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  let result
  try {
    result = await supabase.auth.getClaims()
  } catch {
    // A cookie the library cannot read throws instead of returning an error.
    // It is not a session.
    return null
  }
  const { data, error } = result
  const claims = data?.claims
  if (error || !claims?.sub) return null

  const sessionId = (claims as { session_id?: unknown }).session_id
  if (typeof sessionId !== 'string') return null
  if (!(await sessionStillActive(sessionId, claims.sub))) return null

  return {
    id: claims.sub,
    email: claims.email ?? null,
    signedInAt: lastSignInAt((claims as { amr?: unknown }).amr),
  }
}

// Every page or action that needs a user calls this itself. The proxy and
// layouts are not a substitute (the proxy keeps the cheap getClaims() check
// and only refreshes the session).
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')
  return user
}
