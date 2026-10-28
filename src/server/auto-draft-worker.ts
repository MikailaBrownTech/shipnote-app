import 'server-only'
import { QUEUE_RETRIES, type AutoDraftJob } from '@/lib/auto-draft-job'
import { generateAutoDraft, type AutoFailure } from './draft-generation'
import {
  claimAutoDraftJob,
  finishAutoDraftJob,
  releaseAutoDraftJob,
} from './supabase-admin'

// Runs one automatic-draft job, after the door has checked the queue's signature
// and the message has been validated. The job is claimed once; everything else
// (the project and switch, the commit, the secret check, the reservation, the
// call, the checks, the draft) is the same pipeline as the Generate button.
//
// Nothing here logs. Reasons are fixed codes. No commit text, draft text or
// token is returned or stored here.

export type WorkerOutcome =
  | 'done' // a draft was written
  | 'duplicate' // already claimed or finished (a duplicate delivery): nothing done
  | 'skipped' // ended without a draft, on purpose; do not retry
  | 'retry' // a temporary problem; the queue should try again
  | 'failed' // ended as failed; do not retry

// Ended without a draft, and not an error: the limit is reached, or the commit
// or project is no longer eligible. The queue is told success so it never retries.
const SKIPPED: readonly AutoFailure[] = [
  'daily_limit',
  'monthly_cap',
  'no_tag',
  'merge_commit',
  'project_gone',
  'disabled',
]

// Will not get better by trying again.
const PERMANENT: readonly AutoFailure[] = [
  'commit_not_found',
  'github_gone',
  'secret',
  'voice_secret',
  'invalid_output',
  'no_content',
]

export async function runAutoDraftJob(
  job: AutoDraftJob,
  // How many times the queue has already retried this message (0 the first time).
  retried: number,
): Promise<WorkerOutcome> {
  const claimed = await claimAutoDraftJob({
    userId: job.userId,
    projectId: job.projectId,
    commitSha: job.commitSha,
  })
  // The database could not be reached: nothing was claimed, so the queue may try
  // again.
  if (!claimed.ok) return 'retry'
  // Not queued, or not this user's: a duplicate delivery. Success, no work.
  if (claimed.id === null) return 'duplicate'
  const jobId = claimed.id

  const finish = (
    status: 'done' | 'skipped' | 'failed',
    reason: string | null,
    draftId: string | null,
  ) =>
    finishAutoDraftJob({
      jobId,
      userId: job.userId,
      status,
      reason,
      draftId,
    })

  // A temporary problem: put the job back so the retry can claim it, unless this
  // was the last try.
  const retryOrGiveUp = async (reason: string): Promise<WorkerOutcome> => {
    if (retried >= QUEUE_RETRIES) {
      await finish('failed', reason, null)
      return 'failed'
    }
    await releaseAutoDraftJob(jobId, job.userId)
    return 'retry'
  }

  let result
  try {
    result = await generateAutoDraft({
      userId: job.userId,
      projectId: job.projectId,
      commitSha: job.commitSha,
    })
  } catch {
    // Nothing about the error is kept: it could hold text from the request.
    return retryOrGiveUp('failed')
  }

  if (result.ok) {
    await finish('done', null, result.draftId)
    return 'done'
  }
  const { reason } = result
  if (SKIPPED.includes(reason)) {
    await finish('skipped', reason, null)
    return 'skipped'
  }
  if (PERMANENT.includes(reason)) {
    await finish('failed', reason, null)
    return 'failed'
  }
  // provider, github_retry, failed
  return retryOrGiveUp(reason)
}
