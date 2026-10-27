import 'server-only'
import { z } from 'zod'
import { signedInWithin } from '@/lib/auth-claims'
import { rateLimit } from './rate-limit'
import { softDeleteAuthUser } from './supabase-admin'

// Deleting an account needs a sign-in from the last 10 minutes.
export const RECENT_SIGN_IN_SECONDS = 10 * 60

export type DeleteOutcome =
  | 'deleted'
  | 'confirm' // the typed text did not match
  | 'recent' // the last sign-in is too old
  | 'limited'
  | 'failed'

type DeletingUser = {
  id: string
  email: string | null
  signedInAt: number | null
}

const input = z.object({ confirm: z.string().max(320) })

// Used by the account page to choose between the form and "sign in again".
export function hasRecentSignIn(
  user: Pick<DeletingUser, 'signedInAt'>,
  now: number = Date.now(),
) {
  return signedInWithin(user.signedInAt, RECENT_SIGN_IN_SECONDS, now)
}

// What the user must type. Almost always their email address.
export function confirmationText(user: Pick<DeletingUser, 'email'>) {
  return user.email ?? 'delete my account'
}

// The caller has already verified the user with requireUser(). Nothing here
// logs the email or user id.
export async function deleteAccount(
  user: DeletingUser,
  raw: unknown,
  now: number = Date.now(),
): Promise<DeleteOutcome> {
  if (!(await rateLimit('deleteAccount', user.id))) return 'limited'

  const parsed = input.safeParse(raw)
  if (!parsed.success) return 'confirm'
  const typed = parsed.data.confirm.trim().toLowerCase()
  if (typed !== confirmationText(user).toLowerCase()) return 'confirm'

  if (!hasRecentSignIn(user, now)) {
    return 'recent'
  }

  return (await softDeleteAuthUser(user.id)) ? 'deleted' : 'failed'
}
