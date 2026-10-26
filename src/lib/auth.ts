import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type CurrentUser = {
  id: string
  email: string | null
}

// Verifies the signed token with getClaims(). getSession() only reads the
// cookie, which the client can forge, so it is never used to identify a user.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) return null
  return { id: claims.sub, email: claims.email ?? null }
}

// Every page or action that needs a user calls this itself. The proxy and
// layouts are not a substitute.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')
  return user
}
