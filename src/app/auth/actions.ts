'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { clearAuthCookies } from '@/lib/auth-cookies'
import { createClient } from '@/lib/supabase/server'

export type SignOutState = { error: string | null }

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' })
  await clearAuthCookies()
  redirect('/')
}

// Revokes every refresh token for the user, on every device. Access tokens
// already issued stay valid until they expire (see the README).
export async function signOutEverywhere(): Promise<SignOutState> {
  await requireUser()

  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  // This browser is signed out either way. The user is told if the other
  // devices could not be revoked, so they can try again.
  await clearAuthCookies()

  if (error) {
    redirect('/sign-in?error=signout')
  }
  redirect('/sign-in')
}
