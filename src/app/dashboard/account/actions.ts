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
  const report: {
    cleanup: { hadConnection: boolean; couldNotCancel: number } | null
  } = { cleanup: null }
  const outcome = await deleteAccount(
    user,
    { confirm: formData.get('confirm') },
    Date.now(),
    (result) => {
      report.cleanup = result
    },
  )

  if (outcome === 'recent') {
    await rememberNext('/dashboard/account')
    redirect('/sign-in?reauth=1')
  }
  if (outcome !== 'deleted') return { error: outcome }

  // The account is soft-deleted, which already removed its sessions. Sign out
  // everywhere anyway, in case any survive, then clear this browser. The
  // revoke call may be refused because the session no longer exists; that is
  // expected, and the cookies are cleared regardless.
  try {
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: 'global' })
  } catch {
    // Nothing to do. The cookies are cleared next.
  }
  await clearAuthCookies()
  // What is left to do in Buffer, as two small numbers. The page reads them
  // strictly and shows fixed wording.
  const left = report.cleanup
  const query = new URLSearchParams()
  if (left?.hadConnection) query.set('buffer', '1')
  if (left && left.couldNotCancel > 0) {
    query.set('left', String(Math.min(left.couldNotCancel, 999)))
  }

  redirect(
    query.size > 0
      ? `/account-deleted?${query.toString()}`
      : '/account-deleted',
  )
}

// Sends the user through sign-in again, then back to the account page.
export async function reauthenticate() {
  await requireUser()
  await rememberNext('/dashboard/account')
  redirect('/sign-in?reauth=1')
}
