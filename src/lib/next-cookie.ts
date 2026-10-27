import 'server-only'
import { cookies } from 'next/headers'
import { sessionCookieOptions } from '@/lib/cookie-options'

// Where to go after the next sign-in. It lives in a cookie set by the server,
// not in the redirect URL, because the redirect URL must match an exact entry
// in the Supabase allow list. The callback still runs the value through
// safeNext().
export const NEXT_COOKIE = 'sn_next'
export const NEXT_COOKIE_PATH = '/auth'

export function nextCookieOptions() {
  return { ...sessionCookieOptions(), path: NEXT_COOKIE_PATH }
}

export async function rememberNext(path: string) {
  const store = await cookies()
  store.set(NEXT_COOKIE, path, { ...nextCookieOptions(), maxAge: 10 * 60 })
}
