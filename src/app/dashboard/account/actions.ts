'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { clearAuthCookies } from '@/lib/auth-cookies'
import { rememberNext } from '@/lib/next-cookie'
import { createClient } from '@/lib/supabase/server'
import { deleteAccount, type DeleteOutcome } from '@/server/delete-account'

export type DeleteState = { error: Exclude<DeleteOutcome, 'deleted'> | null }

export async function deleteAccountAction(
  _previous: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const user = await requireUser()
  const outcome = await deleteAccount(user, {
    confirm: formData.get('confirm'),
  })

  if (outcome === 'recent') {
    await rememberNext('/dashboard/account')
    redirect('/sign-in?reauth=1')
  }
  if (outcome !== 'deleted') return { error: outcome }

  // The user is gone. Clearing the cookies is what matters; the revoke call
  // may fail because the session no longer exists.
  try {
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Nothing to do. The cookies are cleared next.
  }
  await clearAuthCookies()
  redirect('/account-deleted')
}

// Sends the user through sign-in again, then back to the account page.
export async function reauthenticate() {
  await requireUser()
  await rememberNext('/dashboard/account')
  redirect('/sign-in?reauth=1')
}
