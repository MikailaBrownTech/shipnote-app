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

// Removes the user row for good. Only for an account that was created a moment
// ago and has no data (the unverified-GitHub backstop). People deleting their
// own account go through softDeleteAuthUser.
export async function hardDeleteAuthUser(userId: string): Promise<boolean> {
  const { error } = await admin().auth.admin.deleteUser(userId)
  return !error
}

// Soft delete: Supabase sets auth.users.deleted_at, removes the user's
// sessions, and scrambles the email, identities and metadata so the account
// can never be signed into again. The row (and so every table that references
// it) stays. Not reversible. Does nothing if the user is already deleted.
export async function softDeleteAuthUser(userId: string): Promise<boolean> {
  const { error } = await admin().auth.admin.deleteUser(userId, true)
  return !error
}

// Does this session still exist, for a user whose account is not deleted?
// Fails closed: any error counts as "not active".
export async function isSessionActive(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const response = await admin().rpc('session_is_active', {
    p_session_id: sessionId,
    p_user_id: userId,
  })
  return !response.error && response.data === true
}

// How many sessions the user has left, or null if that could not be read.
export async function countSessions(userId: string): Promise<number | null> {
  const response = await admin().rpc('active_session_count', {
    p_user_id: userId,
  })
  if (response.error || typeof response.data !== 'number') return null
  return response.data
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

// ---- GitHub connection ----
//
// These four functions are the only service-role writes for the GitHub
// feature, and each does one narrow thing. Users have no insert, update or
// delete privileges on github_installations, nor on the link columns of
// projects, so these run only after server code has verified the request with
// GitHub (installation ownership) or against the installation's repository
// list. Every one filters by user_id, and the composite foreign key on
// projects refuses an installation that belongs to someone else.

export type SaveInstallationResult = 'saved' | 'taken' | 'failed'

// Records that this user owns this installation. 'taken' means the installation
// already belongs to a different user; it is not changed.
export async function saveGithubInstallation(input: {
  userId: string
  installationId: number
  accountLogin: string
  accountId: number
}): Promise<SaveInstallationResult> {
  const client = admin()
  const existing = await client
    .from('github_installations')
    .select('user_id')
    .eq('installation_id', input.installationId)
    .maybeSingle()
  if (existing.error) return 'failed'

  const owner = (existing.data as { user_id?: unknown } | null)?.user_id
  if (owner !== undefined && owner !== input.userId) return 'taken'

  const write = owner
    ? await client
        .from('github_installations')
        .update({
          account_login: input.accountLogin,
          account_id: input.accountId,
        })
        .eq('installation_id', input.installationId)
        .eq('user_id', input.userId)
    : await client.from('github_installations').insert({
        user_id: input.userId,
        installation_id: input.installationId,
        account_login: input.accountLogin,
        account_id: input.accountId,
      })
  if (!write.error) return 'saved'
  // Two requests racing for the same installation: the unique key decides.
  return write.error.code === '23505' ? 'taken' : 'failed'
}

// Removes the user's own installation row (it does not uninstall the App on
// GitHub). Projects that used it keep their repository name and lose the
// installation id, which the app shows as "needs reconnect".
export async function removeGithubInstallation(
  userId: string,
  installationId: number,
): Promise<boolean> {
  const { error } = await admin()
    .from('github_installations')
    .delete()
    .eq('user_id', userId)
    .eq('installation_id', installationId)
  return !error
}

// Links one of the user's projects to a repository. The caller has already
// checked the repository is on the installation's list.
export async function linkProjectRepo(input: {
  userId: string
  projectId: string
  installationId: number
  repoFullName: string
}): Promise<boolean> {
  const { data, error } = await admin()
    .from('projects')
    .update({
      installation_id: input.installationId,
      repo_full_name: input.repoFullName,
    })
    .eq('id', input.projectId)
    .eq('user_id', input.userId)
    .select('id')
  return !error && (data as unknown[]).length === 1
}

export async function unlinkProjectRepo(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await admin()
    .from('projects')
    .update({ installation_id: null, repo_full_name: null })
    .eq('id', projectId)
    .eq('user_id', userId)
    .select('id')
  return !error && (data as unknown[]).length === 1
}
