import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import { getAdminEnv } from './env'

// The only place the service role key is used. It bypasses row-level
// security, so keep this module small and never import it outside src/server/
// (an ESLint rule enforces that).
export async function deleteAuthUser(userId: string): Promise<boolean> {
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getAdminEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error } = await admin.auth.admin.deleteUser(userId)
  return !error
}
