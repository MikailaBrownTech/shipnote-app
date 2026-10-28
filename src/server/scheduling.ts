import 'server-only'
import { createHash } from 'node:crypto'
import { env } from '@/lib/env'
import { parseScheduleTime } from '@/lib/schedule-time'
import { secretProblem } from '@/lib/secret-scan'
import {
  authorizeUrl,
  BufferError,
  createScheduledPost as createAtBuffer,
  deleteScheduledPost,
  exchangeCode,
  fetchOrganizationId,
  getPostStatus,
  listLinkedInChannels,
  type Channel,
} from './buffer'
import { startState, type ReturnTo } from './buffer-state'
import { getSchedulingEnv, schedulingEnabled } from './env'
import { getDraft } from './drafts'
import {
  getConnectionStatus,
  getScheduledPost,
  listActiveSchedules,
  listProjectSchedules,
  type ScheduledPost,
} from './scheduled-posts'
import {
  createScheduledPost as createRow,
  deleteBufferConnection,
  finishScheduledPost,
  markPostScheduled,
  saveBufferConnection,
} from './supabase-admin'
import { sealToken } from './token-vault'

// The rules for scheduling a draft through the user's own Buffer account. The
// actions and the callback route call these; nothing else makes a Buffer call.
//
// Nothing is scheduled without a reviewed snapshot: the action passes the hash
// of the text the person reviewed, and the draft is read again here and must
// still hash the same. Nothing here logs, and results are fixed codes.

export const SCHEDULE_DAILY_LIMIT = 5

// The most time spent calling Buffer to cancel posts when cleaning up.
const CLEANUP_BUDGET_MS = 20_000

export function schedulingIsEnabled(): boolean {
  return schedulingEnabled()
}

export function callbackUrl(): string {
  return new URL('/dashboard/buffer/callback', env.NEXT_PUBLIC_SITE_URL).href
}

// Hash of the exact text. The same function makes the hash the person's review
// carries and the one the server compares it with.
export function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

// ---- Connecting ----

// Sets the signed state cookie and returns Buffer's authorization URL for the
// person to be sent to, or null while scheduling is off.
export async function beginConnect(
  userId: string,
  returnTo: ReturnTo,
): Promise<string | null> {
  const settings = getSchedulingEnv()
  if (!settings) return null
  const { state, challenge } = await startState(userId, returnTo)
  return authorizeUrl({
    clientId: settings.clientId,
    redirectUri: callbackUrl(),
    state,
    challenge,
  })
}

export type ConnectResult =
  | 'connected'
  | 'denied' // Buffer refused the code (used, expired, or the person said no)
  | 'no_organization' // the Buffer account has no organization to read channels from
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

// After the callback has checked the state: trade the code for tokens, find the
// organization, and store the tokens sealed for this user.
export async function completeConnect(input: {
  userId: string
  code: string
  verifier: string
  nowMs?: number
}): Promise<ConnectResult> {
  const settings = getSchedulingEnv()
  const current = settings?.keys[0]
  if (!settings || !current) return 'failed'
  try {
    const tokens = await exchangeCode({
      code: input.code,
      verifier: input.verifier,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: callbackUrl(),
      nowMs: input.nowMs,
    })
    const organizationId = await fetchOrganizationId(tokens.accessToken)
    if (!organizationId) return 'no_organization'
    const saved = await saveBufferConnection({
      userId: input.userId,
      accessTokenEnc: sealToken({
        plaintext: tokens.accessToken,
        userId: input.userId,
        key: current.key,
      }),
      refreshTokenEnc: tokens.refreshToken
        ? sealToken({
            plaintext: tokens.refreshToken,
            userId: input.userId,
            key: current.key,
          })
        : null,
      keyVersion: current.version,
      expiresAt: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
      scopes: tokens.scope,
      organizationId,
    })
    return saved ? 'connected' : 'failed'
  } catch (error) {
    if (!(error instanceof BufferError)) return 'failed'
    if (error.kind === 'needs_reconnect') return 'denied'
    if (error.kind === 'rate_limited') return 'rate_limited'
    return 'unavailable'
  }
}

// ---- Channels ----

export type ChannelsResult =
  | { ok: true; channels: Channel[] }
  | { ok: false; reason: 'needs_reconnect' | 'rate_limited' | 'unavailable' }

export async function channelsFor(
  userId: string,
  nowMs?: number,
): Promise<ChannelsResult> {
  try {
    return { ok: true, channels: await listLinkedInChannels(userId, nowMs) }
  } catch (error) {
    return { ok: false, reason: failureReason(error) }
  }
}

function failureReason(
  error: unknown,
): 'needs_reconnect' | 'rate_limited' | 'unavailable' {
  if (error instanceof BufferError) {
    if (error.kind === 'needs_reconnect') return 'needs_reconnect'
    if (error.kind === 'rate_limited') return 'rate_limited'
  }
  return 'unavailable'
}

// ---- Scheduling ----

export type ScheduleFailure =
  | 'not_found' // no such draft of theirs
  | 'invalid_time'
  | 'too_soon'
  | 'too_far'
  | 'text_changed' // the draft differs from what was reviewed
  | 'secret' // the draft looks like it holds a key or a token: nothing was sent
  | 'channel' // not one of the user's LinkedIn channels
  | 'needs_reconnect'
  | 'daily_limit' // 5 schedules created today
  | 'already_scheduled'
  | 'rate_limited'
  | 'plan_limit' // the user's Buffer plan or channel limit
  | 'rejected' // Buffer refused the post
  | 'unavailable' // nothing was sent
  | 'unknown_result' // may or may not have been scheduled: check Buffer
  | 'failed'

export type ScheduleResult =
  | { ok: true; id: string; scheduledFor: string }
  | { ok: false; reason: ScheduleFailure }

export async function scheduleDraft(input: {
  userId: string
  draftId: string
  // Hash of the text the person reviewed.
  reviewedHash: string
  channelId: string
  // "YYYY-MM-DDTHH:mm" in the person's time zone, and that zone's name.
  local: string
  timeZone: string
  nowMs?: number
}): Promise<ScheduleResult> {
  const nowMs = input.nowMs ?? Date.now()
  const fail = (reason: ScheduleFailure): ScheduleResult => ({
    ok: false,
    reason,
  })

  const time = parseScheduleTime({
    local: input.local,
    timeZone: input.timeZone,
    nowMs,
  })
  if (!time.ok) {
    return fail(time.reason === 'invalid' ? 'invalid_time' : time.reason)
  }

  const draft = await getDraft(input.userId, input.draftId)
  if (draft === 'not_found') return fail('not_found')
  if (draft === 'failed') return fail('failed')
  // The snapshot sent to Buffer is the text as it is saved now, and it must be
  // the text the person looked at.
  const hash = bodyHash(draft.body)
  if (hash !== input.reviewedHash) return fail('text_changed')
  // The last check before the text leaves for Buffer. The review and the save
  // check too, but a draft can reach this point by other routes (an older draft, a
  // write straight to the database), so this one is the one that counts.
  if (secretProblem(draft.body, 'the draft') !== null) return fail('secret')

  // The channel must be one of this user's own LinkedIn channels.
  const channels = await channelsFor(input.userId, nowMs)
  if (!channels.ok) return fail(channels.reason)
  const channel = channels.channels.find((c) => c.id === input.channelId)
  if (!channel) return fail('channel')

  // The row comes first. If Buffer then times out we still know a request was
  // made, and the unique index stops a second one for the same draft.
  const row = await createRow({
    userId: input.userId,
    draftId: draft.id,
    body: draft.body,
    bodyHash: hash,
    channelId: channel.id,
    channelLabel: channel.label,
    scheduledFor: time.utc.toISOString(),
    dailyLimit: SCHEDULE_DAILY_LIMIT,
  })
  if (!row.ok) {
    if (row.reason === 'daily_limit') return fail('daily_limit')
    if (row.reason === 'already_scheduled') return fail('already_scheduled')
    if (row.reason === 'not_found') return fail('not_found')
    return fail('failed')
  }

  try {
    const created = await createAtBuffer({
      userId: input.userId,
      channelId: channel.id,
      text: draft.body,
      dueAt: time.utc,
      nowMs,
    })
    const marked = await markPostScheduled({
      id: row.id,
      userId: input.userId,
      bufferPostId: created.postId,
    })
    if (!marked) {
      // Buffer has it but we could not record that. Say so, loudly.
      await finishScheduledPost({
        id: row.id,
        userId: input.userId,
        status: 'failed',
        failureCode: 'record_failed',
      })
      return fail('unknown_result')
    }
    return { ok: true, id: row.id, scheduledFor: time.utc.toISOString() }
  } catch (error) {
    const kind = error instanceof BufferError ? error.kind : 'unknown_result'
    // A refusal that came before anything ran is safe to report plainly. Any
    // other failure may have scheduled the post, so it is never retried.
    const known: Partial<Record<string, ScheduleFailure>> = {
      needs_reconnect: 'needs_reconnect',
      rate_limited: 'rate_limited',
      limit_reached: 'plan_limit',
      invalid: 'rejected',
    }
    const reason = known[kind] ?? 'unknown_result'
    await finishScheduledPost({
      id: row.id,
      userId: input.userId,
      status: 'failed',
      failureCode: kind === 'invalid' ? 'rejected' : kind,
    })
    return fail(reason)
  }
}

// ---- Cancelling ----

export type CancelResult =
  | 'canceled'
  | 'published' // Buffer had already published it
  | 'not_found'
  | 'not_active' // already ended
  | 'in_progress' // still being scheduled: check Buffer
  | 'needs_reconnect'
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

export async function cancelSchedule(input: {
  userId: string
  id: string
  nowMs?: number
}): Promise<CancelResult> {
  const post = await getScheduledPost(input.userId, input.id)
  if (post === 'not_found') return 'not_found'
  if (post === 'failed') return 'failed'
  if (post.status === 'canceled') return 'canceled'
  if (post.status === 'published') return 'published'
  if (post.status === 'failed') return 'not_active'
  if (post.status === 'scheduling' || !post.bufferPostId) return 'in_progress'

  const end = (status: 'canceled' | 'published', result: CancelResult) =>
    finishScheduledPost({
      id: post.id,
      userId: input.userId,
      status,
      failureCode: null,
    }).then((ok) => (ok ? result : ('failed' as const)))

  try {
    await deleteScheduledPost(input.userId, post.bufferPostId, input.nowMs)
    return await end('canceled', 'canceled')
  } catch (error) {
    if (!(error instanceof BufferError)) return 'failed'
    // Already gone at Buffer: the aim (it will not publish) is met.
    if (error.kind === 'not_found') return end('canceled', 'canceled')
    if (error.kind === 'invalid') {
      // Buffer refused to delete it, usually because it is already published.
      try {
        const status = await getPostStatus(
          input.userId,
          post.bufferPostId,
          input.nowMs,
        )
        if (status === 'sent') return await end('published', 'published')
      } catch {
        return 'unavailable'
      }
      return 'failed'
    }
    return failureReason(error)
  }
}

// ---- Refreshing statuses ----

export type RefreshResult =
  | { ok: true; updated: number }
  | { ok: false; reason: 'needs_reconnect' | 'rate_limited' | 'unavailable' }

// Asks Buffer about one scheduled post and records what it says: published, failed
// (Buffer reported an error) or canceled (the person removed it in Buffer). True
// if the post changed. Anything else, still scheduled for example, is left as it
// is. Throws a BufferError for a Buffer problem (not connected, rate limited).
export async function refreshOne(input: {
  userId: string
  post: ScheduledPost
  nowMs?: number
}): Promise<boolean> {
  const { post, userId } = input
  if (!post.bufferPostId) return false
  try {
    const status = await getPostStatus(userId, post.bufferPostId, input.nowMs)
    if (status !== 'sent' && status !== 'error') return false
    return await finishScheduledPost({
      id: post.id,
      userId,
      status: status === 'sent' ? 'published' : 'failed',
      failureCode: status === 'error' ? 'buffer_error' : null,
    })
  } catch (error) {
    if (error instanceof BufferError && error.kind === 'not_found') {
      // Removed in Buffer by the person.
      return await finishScheduledPost({
        id: post.id,
        userId,
        status: 'canceled',
        failureCode: null,
      })
    }
    throw error
  }
}

// Asks Buffer about the project's scheduled posts and records the ones that
// have been published or have failed. At most 10 posts, one request each.
export async function refreshStatuses(input: {
  userId: string
  projectId: string
  nowMs?: number
}): Promise<RefreshResult> {
  const posts = await listProjectSchedules(input.userId, input.projectId, 20)
  if (!posts) return { ok: false, reason: 'unavailable' }
  const pending = posts
    .filter((p) => p.status === 'scheduled' && p.bufferPostId)
    .slice(0, 10)
  let updated = 0
  for (const post of pending) {
    try {
      if (
        await refreshOne({ userId: input.userId, post, nowMs: input.nowMs })
      ) {
        updated += 1
      }
    } catch (error) {
      return { ok: false, reason: failureReason(error) }
    }
  }
  return { ok: true, updated }
}

// ---- Disconnecting and account deletion ----

export type CleanupResult = {
  // Schedules that were cancelled at Buffer.
  canceled: number
  // Schedules that could not be cancelled at Buffer: they may still publish.
  couldNotCancel: number
  // Whether the person had a Buffer connection at all.
  hadConnection: boolean
}

// Best effort: cancel every active schedule at Buffer if possible, mark each
// one canceled in Shipnote either way (it is no longer ours to manage), and
// report how many could not be cancelled at Buffer. Never throws.
async function cancelAllActive(
  userId: string,
  cancelAtBuffer: boolean,
  nowMs?: number,
): Promise<{ canceled: number; couldNotCancel: number }> {
  let canceled = 0
  let couldNotCancel = 0
  const active = await listActiveSchedules(userId)
  // Stop calling Buffer after a while, so deleting an account is never held up
  // by a slow Buffer. Whatever is left is reported as not cancelled.
  const giveUpAt = Date.now() + CLEANUP_BUDGET_MS
  for (const post of active ?? []) {
    let gone = false
    if (cancelAtBuffer && post.bufferPostId && Date.now() < giveUpAt) {
      try {
        await deleteScheduledPost(userId, post.bufferPostId, nowMs)
        gone = true
      } catch (error) {
        gone = error instanceof BufferError && error.kind === 'not_found'
      }
    }
    if (gone) canceled += 1
    else couldNotCancel += 1
    await finishScheduledPost({
      id: post.id,
      userId,
      status: 'canceled',
      failureCode: null,
    })
  }
  return { canceled, couldNotCancel }
}

// "Disconnect Buffer". With cancelFirst, scheduled posts are cancelled at
// Buffer before the tokens are deleted. Buffer documents no way to revoke a
// token, so the person must also remove Shipnote in their Buffer settings.
export async function disconnectBuffer(input: {
  userId: string
  cancelFirst: boolean
  nowMs?: number
}): Promise<{ ok: boolean } & Omit<CleanupResult, 'hadConnection'>> {
  const { canceled, couldNotCancel } = input.cancelFirst
    ? await cancelAllActive(input.userId, true, input.nowMs)
    : { canceled: 0, couldNotCancel: 0 }
  const ok = await deleteBufferConnection(input.userId)
  return { ok, canceled, couldNotCancel }
}

// Before an account is soft-deleted: cancel scheduled posts at Buffer, then
// delete the stored tokens. A failure never blocks deletion: the connection row
// is deleted whatever happens.
export async function cleanupForDeletion(
  userId: string,
  nowMs?: number,
): Promise<CleanupResult> {
  // Read before deleting. If it cannot be read, assume there was one, so the
  // person is still told to remove Shipnote in Buffer.
  const status = await getConnectionStatus()
  const had = status === null || status.state !== 'none'
  if (!schedulingEnabled()) {
    // The kill switch is off, so no Buffer call is made, but the tokens are
    // still removed from our database.
    await deleteBufferConnection(userId)
    const active = (await listActiveSchedules(userId)) ?? []
    for (const post of active) {
      await finishScheduledPost({
        id: post.id,
        userId,
        status: 'canceled',
        failureCode: null,
      })
    }
    return {
      canceled: 0,
      couldNotCancel: active.length,
      hadConnection: had,
    }
  }
  const result = await cancelAllActive(userId, true, nowMs)
  await deleteBufferConnection(userId)
  return { ...result, hadConnection: had }
}
