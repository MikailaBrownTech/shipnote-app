import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import { normalizeVoice, type VoiceProfile } from '@/lib/voice'
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

// ---- Draft generation ----
//
// Narrow wrappers over the generation functions in Postgres (see
// supabase/migrations/20261030000100_drafts.sql). Only the service role may
// call them. The limits live in the database: these only pass arguments and
// read the answer, and any surprise is treated as a refusal (fail closed).

export type ReserveResult =
  | { ok: true; usageId: string }
  | { ok: false; reason: 'daily_limit' | 'monthly_cap' | 'failed' }

export async function reserveGeneration(input: {
  userId: string
  estimatedMicrousd: number
  dailyLimit: number
  monthlyCapMicrousd: number
}): Promise<ReserveResult> {
  const response = await admin().rpc('reserve_generation', {
    p_user_id: input.userId,
    p_estimated_microusd: input.estimatedMicrousd,
    p_daily_limit: input.dailyLimit,
    p_monthly_cap_microusd: input.monthlyCapMicrousd,
  })
  if (response.error) {
    if (response.error.code === 'SN010')
      return { ok: false, reason: 'daily_limit' }
    if (response.error.code === 'SN011')
      return { ok: false, reason: 'monthly_cap' }
    return { ok: false, reason: 'failed' }
  }
  const id: unknown = response.data
  return typeof id === 'string' && id.length > 0
    ? { ok: true, usageId: id }
    : { ok: false, reason: 'failed' }
}

// Writes the draft, its commit links and the final cost in one transaction.
// Returns the draft id, or null if nothing was written.
export async function completeGeneration(input: {
  usageId: string
  userId: string
  projectId: string
  body: string
  model: string
  inputTokens: number
  outputTokens: number
  costMicrousd: number
  commitShas: string[]
}): Promise<string | null> {
  const response = await admin().rpc('complete_generation', {
    p_usage_id: input.usageId,
    p_user_id: input.userId,
    p_project_id: input.projectId,
    p_body: input.body,
    p_model: input.model,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_cost_microusd: input.costMicrousd,
    p_commit_shas: input.commitShas,
  })
  const id: unknown = response.data
  return !response.error && typeof id === 'string' ? id : null
}

// The model answered but the answer was unusable: it still counts.
export async function recordUnusableGeneration(
  usageId: string,
  userId: string,
  costMicrousd: number,
): Promise<boolean> {
  const { error } = await admin().rpc('record_unusable_generation', {
    p_usage_id: usageId,
    p_user_id: userId,
    p_cost_microusd: costMicrousd,
  })
  return !error
}

// Provider or network errors only: the generation did not happen.
export async function releaseGeneration(
  usageId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await admin().rpc('release_generation', {
    p_usage_id: usageId,
    p_user_id: userId,
  })
  return !error
}

// How many generations the user has used today (UTC), or null if unknown.
export async function generationsUsedToday(
  userId: string,
): Promise<number | null> {
  const response = await admin().rpc('generations_used_today', {
    p_user_id: userId,
  })
  const used: unknown = response.data
  return !response.error && typeof used === 'number' ? used : null
}

// ---- Buffer scheduling ----
//
// Narrow wrappers over the service-role functions in
// supabase/migrations/20261031000100_buffer_scheduling.sql. The token columns
// are readable by no user role, so everything about a connection goes through
// here. Tokens arrive and leave as ciphertext (see token-vault.ts); nothing
// here logs a value.

export type StoredConnection = {
  accessTokenEnc: string
  refreshTokenEnc: string | null
  keyVersion: number
  expiresAt: string | null
  scopes: string | null
  organizationId: string | null
  status: 'connected' | 'needs_reconnect'
}

export async function saveBufferConnection(input: {
  userId: string
  accessTokenEnc: string
  refreshTokenEnc: string | null
  keyVersion: number
  expiresAt: string | null
  scopes: string | null
  organizationId: string | null
}): Promise<boolean> {
  const response = await admin().rpc('save_buffer_connection', {
    p_user_id: input.userId,
    p_access_token_enc: input.accessTokenEnc,
    p_refresh_token_enc: input.refreshTokenEnc,
    p_key_version: input.keyVersion,
    p_expires_at: input.expiresAt,
    p_scopes: input.scopes,
    p_organization_id: input.organizationId,
  })
  const id: unknown = response.data
  return !response.error && typeof id === 'string'
}

// The user's stored connection, or null if there is none (or the account is
// deleted, or it could not be read).
export async function readBufferConnection(
  userId: string,
): Promise<StoredConnection | null> {
  const response = await admin().rpc('read_buffer_connection', {
    p_user_id: userId,
  })
  if (response.error) return null
  const rows: unknown = response.data
  if (!Array.isArray(rows) || rows.length !== 1) return null
  const row = rows[0] as Record<string, unknown>
  if (
    typeof row.access_token_enc !== 'string' ||
    typeof row.key_version !== 'number' ||
    (row.status !== 'connected' && row.status !== 'needs_reconnect')
  ) {
    return null
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  return {
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: text(row.refresh_token_enc),
    keyVersion: row.key_version,
    expiresAt: text(row.expires_at),
    scopes: text(row.scopes),
    organizationId: text(row.organization_id),
    status: row.status,
  }
}

export async function updateBufferTokens(input: {
  userId: string
  accessTokenEnc: string
  refreshTokenEnc: string | null
  keyVersion: number
  expiresAt: string | null
}): Promise<boolean> {
  const response = await admin().rpc('update_buffer_tokens', {
    p_user_id: input.userId,
    p_access_token_enc: input.accessTokenEnc,
    p_refresh_token_enc: input.refreshTokenEnc,
    p_key_version: input.keyVersion,
    p_expires_at: input.expiresAt,
  })
  const ok: unknown = response.data
  return !response.error && ok === true
}

export async function markBufferNeedsReconnect(
  userId: string,
): Promise<boolean> {
  const { error } = await admin().rpc('mark_buffer_needs_reconnect', {
    p_user_id: userId,
  })
  return !error
}

export async function deleteBufferConnection(userId: string): Promise<boolean> {
  const { error } = await admin().rpc('delete_buffer_connection', {
    p_user_id: userId,
  })
  return !error
}

export type CreateScheduleResult =
  | { ok: true; id: string }
  | {
      ok: false
      reason:
        | 'daily_limit'
        | 'already_scheduled'
        | 'invalid'
        | 'not_found'
        | 'inactive'
        | 'failed'
    }

// Takes the "scheduling" row before Buffer is called.
export async function createScheduledPost(input: {
  userId: string
  draftId: string
  body: string
  bodyHash: string
  channelId: string
  channelLabel: string | null
  scheduledFor: string
  dailyLimit: number
}): Promise<CreateScheduleResult> {
  const response = await admin().rpc('create_scheduled_post', {
    p_user_id: input.userId,
    p_draft_id: input.draftId,
    p_body: input.body,
    p_body_hash: input.bodyHash,
    p_channel_id: input.channelId,
    p_channel_label: input.channelLabel,
    p_scheduled_for: input.scheduledFor,
    p_daily_limit: input.dailyLimit,
  })
  if (response.error) {
    const code = response.error.code
    if (code === 'SN020') return { ok: false, reason: 'daily_limit' }
    // SN021 from the function, 23505 from the unique index if two requests race.
    if (code === 'SN021' || code === '23505') {
      return { ok: false, reason: 'already_scheduled' }
    }
    if (code === 'SN022') return { ok: false, reason: 'invalid' }
    if (code === 'SN023') return { ok: false, reason: 'not_found' }
    if (code === 'SN024') return { ok: false, reason: 'inactive' }
    return { ok: false, reason: 'failed' }
  }
  const id: unknown = response.data
  return typeof id === 'string' && id.length > 0
    ? { ok: true, id }
    : { ok: false, reason: 'failed' }
}

export async function markPostScheduled(input: {
  id: string
  userId: string
  bufferPostId: string
}): Promise<boolean> {
  const response = await admin().rpc('mark_post_scheduled', {
    p_id: input.id,
    p_user_id: input.userId,
    p_buffer_post_id: input.bufferPostId,
  })
  const ok: unknown = response.data
  return !response.error && ok === true
}

// Ends a schedule as canceled, failed or published. failureCode is a short
// fixed code, never text from Buffer.
export async function finishScheduledPost(input: {
  id: string
  userId: string
  status: 'canceled' | 'failed' | 'published'
  failureCode: string | null
}): Promise<boolean> {
  const response = await admin().rpc('finish_scheduled_post', {
    p_id: input.id,
    p_user_id: input.userId,
    p_status: input.status,
    p_failure_code: input.failureCode,
  })
  const ok: unknown = response.data
  return !response.error && ok === true
}

// ---- Automatic drafts ----
//
// Narrow wrappers over the service-role functions in
// supabase/migrations/20261101000100_auto_drafts.sql. They hold identifiers and
// fixed codes only: no commit text, payload, signature or token passes through.

export type DeliveryState = 'new' | 'duplicate' | 'retry'

// Records a GitHub delivery id. 'duplicate' means it was fully handled before.
// Returns null on any failure, which callers treat as "do not work".
export async function recordWebhookDelivery(
  deliveryId: string,
  installationId: number,
): Promise<DeliveryState | null> {
  const response = await admin().rpc('record_webhook_delivery', {
    p_delivery_id: deliveryId,
    p_installation_id: installationId,
  })
  const state: unknown = response.data
  if (response.error) {
    console.warn(
      'auto drafts: database call failed',
      'record_webhook_delivery',
      response.error.code,
    )
    return null
  }
  return state === 'new' || state === 'duplicate' || state === 'retry'
    ? state
    : null
}

export async function finishWebhookDelivery(
  deliveryId: string,
): Promise<boolean> {
  const response = await admin().rpc('finish_webhook_delivery', {
    p_delivery_id: deliveryId,
  })
  const ok: unknown = response.data
  return !response.error && ok === true
}

export type AutoTarget = { userId: string; projectId: string }

// The user and project a push belongs to, found from the installation id and
// the repository name. null when there is no eligible project.
export async function resolveAutoDraftTarget(
  installationId: number,
  repoFullName: string,
): Promise<AutoTarget | null | 'failed'> {
  const response = await admin().rpc('resolve_auto_draft_target', {
    p_installation_id: installationId,
    p_repo_full_name: repoFullName,
  })
  if (response.error) {
    console.warn(
      'auto drafts: database call failed',
      'resolve_auto_draft_target',
      response.error.code,
    )
    return 'failed'
  }
  const rows: unknown = response.data
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0] as { user_id?: unknown; project_id?: unknown }
  return typeof row.user_id === 'string' && typeof row.project_id === 'string'
    ? { userId: row.user_id, projectId: row.project_id }
    : 'failed'
}

// A new job's id, or ok with a null id when the commit already has a job (or is
// not eligible). ok is false if the database could not be reached.
export type JobLookup = { ok: true; id: string | null } | { ok: false }

export async function createAutoDraftJob(input: {
  userId: string
  projectId: string
  commitSha: string
  deliveryId: string
}): Promise<JobLookup> {
  const response = await admin().rpc('create_auto_draft_job', {
    p_user_id: input.userId,
    p_project_id: input.projectId,
    p_commit_sha: input.commitSha,
    p_delivery_id: input.deliveryId,
  })
  if (response.error) {
    console.warn(
      'auto drafts: database call failed',
      'create_auto_draft_job',
      response.error.code,
    )
    return { ok: false }
  }
  const id: unknown = response.data
  return { ok: true, id: typeof id === 'string' ? id : null }
}

// The job's id if this call claimed it (queued to running), otherwise null: it
// was already claimed or finished, or does not exist.
export async function claimAutoDraftJob(input: {
  userId: string
  projectId: string
  commitSha: string
}): Promise<JobLookup> {
  const response = await admin().rpc('claim_auto_draft_job', {
    p_user_id: input.userId,
    p_project_id: input.projectId,
    p_commit_sha: input.commitSha,
  })
  if (response.error) return { ok: false }
  const id: unknown = response.data
  return { ok: true, id: typeof id === 'string' ? id : null }
}

export async function releaseAutoDraftJob(
  jobId: string,
  userId: string,
): Promise<boolean> {
  const response = await admin().rpc('release_auto_draft_job', {
    p_job_id: jobId,
    p_user_id: userId,
  })
  const ok: unknown = response.data
  return !response.error && ok === true
}

export async function finishAutoDraftJob(input: {
  jobId: string
  userId: string
  status: 'done' | 'skipped' | 'failed'
  // A short fixed code, never text from a commit or a response.
  reason: string | null
  draftId: string | null
}): Promise<boolean> {
  const response = await admin().rpc('finish_auto_draft_job', {
    p_job_id: input.jobId,
    p_user_id: input.userId,
    p_status: input.status,
    p_reason: input.reason,
    p_draft_id: input.draftId,
  })
  const ok: unknown = response.data
  return !response.error && ok === true
}

export type AutoProject = {
  name: string
  summary: string | null
  stage: string
  notes: string | null
  repoFullName: string
  installationId: number
}

// The fields needed to write a draft for a project, but only while it still
// belongs to the user with the switch on and a linked repository, and the
// account is not deleted. null otherwise, or 'failed' if it could not be read.
export async function readProjectForAutoDraft(
  userId: string,
  projectId: string,
): Promise<AutoProject | null | 'failed'> {
  const response = await admin().rpc('read_project_for_auto_draft', {
    p_user_id: userId,
    p_project_id: projectId,
  })
  if (response.error) return 'failed'
  const rows: unknown = response.data
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0] as Record<string, unknown>
  const installation = Number(row.installation_id)
  if (
    typeof row.name !== 'string' ||
    typeof row.stage !== 'string' ||
    typeof row.repo_full_name !== 'string' ||
    !Number.isSafeInteger(installation) ||
    installation <= 0
  ) {
    return 'failed'
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  return {
    name: row.name,
    summary: text(row.summary),
    stage: row.stage,
    notes: text(row.notes),
    repoFullName: row.repo_full_name,
    installationId: installation,
  }
}

// The voice profile of the one user a job belongs to, for the automatic draft
// worker, which has no session. null if they have none (or the account is
// deleted), 'failed' if it could not be read. Never logs a value.
export async function readVoiceProfileForWorker(
  userId: string,
): Promise<VoiceProfile | null | 'failed'> {
  const response = await admin().rpc('read_voice_profile', {
    p_user_id: userId,
  })
  if (response.error) return 'failed'
  const rows: unknown = response.data
  if (!Array.isArray(rows) || rows.length === 0) return null
  const found = rows[0] as Record<string, unknown>
  if (typeof found.tone !== 'string') return 'failed'
  return normalizeVoice({
    tone: found.tone,
    notes: found.voice_notes,
    samples: found.sample_posts,
    avoidWords: found.avoid_words,
    signoff: found.signoff,
  })
}
