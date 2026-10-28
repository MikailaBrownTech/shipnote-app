import 'server-only'
import { z } from 'zod'
import { MAX_COMMITS_PER_PUSH, type AutoDraftJob } from '@/lib/auto-draft-job'
import { hasPostTag } from '@/lib/github-commits'
import { QstashError, publishAutoDraftJob } from './qstash'
import {
  createAutoDraftJob,
  finishAutoDraftJob,
  finishWebhookDelivery,
  recordWebhookDelivery,
  resolveAutoDraftTarget,
} from './supabase-admin'

// What happens to a push after the door has checked its signature. Nothing here
// trusts a user or owner id from the payload: the user comes from the
// installation row in our own database. Nothing here logs, and no commit text
// leaves this module: only the 40-character shas go on, as identifiers.

// Only the fields that are used. The rest of GitHub's payload is ignored.
const pushPayload = z.object({
  ref: z.string().max(300),
  deleted: z.boolean().optional(),
  repository: z.object({
    full_name: z.string().max(200),
    default_branch: z.string().max(250).optional(),
  }),
  installation: z.object({ id: z.number().int().positive() }),
  commits: z
    .array(
      z.object({
        id: z.string(),
        message: z.string(),
      }),
    )
    .max(2048),
})

export type PushPayload = z.infer<typeof pushPayload>

export function parsePush(body: unknown): PushPayload | null {
  const parsed = pushPayload.safeParse(body)
  return parsed.success ? parsed.data : null
}

// GitHub's own merge commits. The push payload does not list a commit's
// parents, so this only saves a queue message; the worker checks the real
// parents and skips a merge commit for certain.
const MERGE_MESSAGE =
  /^Merge (?:pull request #\d+|branch '|remote-tracking branch '|tag ')/

// The newest commits of a push, at most five, that carry [post] and are not
// merge commits. Full lower-case shas only.
export function selectCommits(payload: PushPayload): string[] {
  const picked: string[] = []
  for (const commit of payload.commits) {
    if (!/^[0-9a-f]{40}$/.test(commit.id)) continue
    if (!hasPostTag(commit.message)) continue
    if (MERGE_MESSAGE.test(commit.message)) continue
    if (!picked.includes(commit.id)) picked.push(commit.id)
  }
  // GitHub lists a push oldest first, so the newest are at the end.
  return picked.slice(-MAX_COMMITS_PER_PUSH)
}

export type PushOutcome =
  | 'ignored' // nothing to do, and nothing was written
  | 'duplicate' // this delivery was already handled
  | 'queued' // jobs were created and published
  | 'unavailable' // something we depend on failed: GitHub may redeliver

// The default branch only: it is the branch the manual flow lists too.
function isDefaultBranch(payload: PushPayload): boolean {
  const branch = payload.repository.default_branch
  return !!branch && payload.ref === `refs/heads/${branch}`
}

// Why a push was ignored: a fixed code, safe to log and to show in GitHub's
// Recent deliveries. Never anything from the payload.
export type IgnoreReason =
  | 'deleted'
  | 'not_default_branch'
  | 'no_post_commit'
  | 'no_target'

export type PushResult = { outcome: PushOutcome; reason?: IgnoreReason }

export async function handlePush(
  payload: PushPayload,
  deliveryId: string,
): Promise<PushResult> {
  const ignored = (reason: IgnoreReason): PushResult => ({
    outcome: 'ignored',
    reason,
  })
  if (payload.deleted === true) return ignored('deleted')
  if (!isDefaultBranch(payload)) return ignored('not_default_branch')

  const shas = selectCommits(payload)
  if (shas.length === 0) return ignored('no_post_commit')

  // The user and project come from our database, through the installation id
  // GitHub signed, not from anything the payload says about owners.
  const target = await resolveAutoDraftTarget(
    payload.installation.id,
    payload.repository.full_name,
  )
  if (target === 'failed') return { outcome: 'unavailable' }
  if (target === null) return ignored('no_target')

  const state = await recordWebhookDelivery(deliveryId, payload.installation.id)
  if (state === null) return { outcome: 'unavailable' }
  if (state === 'duplicate') return { outcome: 'duplicate' }

  let allQueued = true
  for (const commitSha of shas) {
    const job: AutoDraftJob = {
      projectId: target.projectId,
      userId: target.userId,
      commitSha,
      deliveryId,
    }
    const created = await createAutoDraftJob(job)
    if (!created.ok) {
      allQueued = false
      continue
    }
    // This commit already has a job (an earlier push or a redelivery).
    if (created.id === null) continue
    try {
      await publishAutoDraftJob(job)
    } catch (error) {
      if (!(error instanceof QstashError)) throw error
      await finishAutoDraftJob({
        jobId: created.id,
        userId: target.userId,
        status: 'failed',
        reason: 'queue_unavailable',
        draftId: null,
      })
      allQueued = false
    }
  }
  // Only a delivery that was fully handled is marked processed, so a redelivery
  // of one that was not will be worked again (creating jobs is idempotent).
  if (!allQueued) return { outcome: 'unavailable' }
  await finishWebhookDelivery(deliveryId)
  return { outcome: 'queued' }
}

// Reads a request body up to a limit, never more. 'too_large' as soon as the
// declared length, or the bytes actually read, pass the limit.
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Buffer | 'too_large' | 'failed'> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared)) return 'failed'
    if (Number(declared) > maxBytes) return 'too_large'
  }
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return 'too_large'
      }
      chunks.push(value)
    }
  } catch {
    return 'failed'
  }
  return Buffer.concat(chunks)
}
