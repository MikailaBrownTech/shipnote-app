import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  sessionCookieOptions,
  withSessionCookieOptions,
} from '@/lib/cookie-options'
import { env } from '@/lib/env'

// A new client per request. Never share one across requests.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      // Merged into every cookie the client writes: the session (and each
      // numbered chunk of it), the PKCE code verifier, and removals.
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, withSessionCookieOptions(options)),
            )
          } catch {
            // Server Components cannot set cookies. The proxy refreshes the
            // session and writes them, so this is safe to ignore.
          }
        },
      },
    },
  )
}
