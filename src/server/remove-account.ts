import 'server-only'
import { deleteAuthUser } from './supabase-admin'

// Used only by the sign-in callback, to remove an account that was just
// created from an unverified GitHub email. Returns whether it worked; the
// caller signs the person out either way.
export function removeUnverifiedAccount(userId: string) {
  return deleteAuthUser(userId)
}
