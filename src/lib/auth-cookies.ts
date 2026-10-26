import 'server-only'
import { cookies } from 'next/headers'

// Supabase stores the session in cookies named sb-<project>-auth-token, split
// into numbered chunks when large. signOut() clears them through setAll, but
// that write is swallowed in some contexts, so sign-out paths call this too.
export async function clearAuthCookies() {
  const store = await cookies()
  for (const { name } of store.getAll()) {
    if (name.startsWith('sb-')) store.delete(name)
  }
}
