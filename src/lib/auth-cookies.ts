import 'server-only'
import { cookies } from 'next/headers'
import { withSessionCookieOptions } from '@/lib/cookie-options'

// Supabase stores the session in cookies named sb-<project>-auth-token, split
// into numbered chunks when large. signOut() clears them through setAll, but
// that write is swallowed in some contexts, so sign-out paths call this too.
// The expiry carries the same flags the cookies were set with.
export async function clearAuthCookies() {
  const store = await cookies()
  for (const { name } of store.getAll()) {
    if (name.startsWith('sb-')) {
      store.set(name, '', {
        ...withSessionCookieOptions(undefined),
        maxAge: 0,
        expires: new Date(0),
      })
    }
  }
}
