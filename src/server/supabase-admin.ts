import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import { getAdminEnv } from './env'

// The only place the service role key is used. It bypasses row-level
// security, so keep this module small and never import it outside src/server/
// (an ESLint rule enforces that).
function admin() {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getAdminEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function deleteAuthUser(userId: string): Promise<boolean> {
  const { error } = await admin().auth.admin.deleteUser(userId)
  return !error
}

export type RecordedSignIn = { alert: boolean; eventId: string }

// Calls record_sign_in(), which only the service role may execute. Returns
// null on any failure, so a problem here never blocks a sign-in.
export async function recordSignInEvent(input: {
  userId: string
  method: 'github' | 'email'
  ipPrefix: string | null
  userAgentFamily: string
  deviceHash: string
  allowAlert: boolean
}): Promise<RecordedSignIn | null> {
  const response = await admin().rpc('record_sign_in', {
    p_user_id: input.userId,
    p_method: input.method,
    p_ip_prefix: input.ipPrefix,
    p_user_agent_family: input.userAgentFamily,
    p_device_hash: input.deviceHash,
    p_allow_alert: input.allowAlert,
  })
  if (response.error) return null

  const result = response.data as { alert?: unknown; event_id?: unknown } | null
  if (typeof result?.alert !== 'boolean') return null
  if (typeof result.event_id !== 'string') return null
  return { alert: result.alert, eventId: result.event_id }
}
