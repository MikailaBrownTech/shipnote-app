'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { clearAuthCookies } from '@/lib/auth-cookies'
import { createClient } from '@/lib/supabase/server'
import { remainingSessions } from '@/server/session-check'

export type SignOutState = { error: string | null }

// Signs out this browser. The cookies are cleared whatever happens at Supabase:
// a sign-out that failed halfway must never leave this browser signed in.
export async function signOut() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Nothing to do: the cookies are cleared next.
  }
  await clearAuthCookies()
  redirect('/')
}

// Revokes every refresh token for the user, on every device. Access tokens
// already issued stay valid until they expire (see the README).
export async function signOutEverywhere(): Promise<SignOutState> {
  const user = await requireUser()

  // Order matters. signOut() reads the access token from the session cookie
  // and sends it to /logout?scope=global. If the cookie were cleared first
  // there would be no token, the library would send nothing, and it would
  // still report success.
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'global' })

  // The library treats a 401, 403 or 404 from /logout as success, so a
  // success result proves little. Ask the database whether any session is left.
  const remaining = await remainingSessions(user.id)

  // This browser is signed out either way. The user is told if the other
  // devices could not be confirmed signed out, so they can try again.
  await clearAuthCookies()

  if (error || remaining !== 0) {
    redirect('/sign-in?error=signout')
  }
  redirect('/sign-in')
}
