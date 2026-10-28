import { z } from 'zod'

// The message that goes through the queue for one automatic draft. Identifiers
// only: no commit text, no notes, no token. The worker reads it with this exact
// schema, after the signature has been checked, and refuses anything else.
export const autoDraftJob = z.strictObject({
  projectId: z.uuid(),
  userId: z.uuid(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  deliveryId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
})

export type AutoDraftJob = z.infer<typeof autoDraftJob>

// The most a queue message may be. The real one is about 200 bytes.
export const MAX_JOB_BYTES = 2048

// The most a GitHub push body may be, in bytes. GitHub allows up to 25 MB; a
// push that large is refused here (and shows as a failed delivery on GitHub),
// which keeps the unauthenticated surface small.
export const MAX_WEBHOOK_BYTES = 1024 * 1024

// Per push, and the job's QStash retry limit.
export const MAX_COMMITS_PER_PUSH = 5
export const QUEUE_RETRIES = 3

// How a job is told apart in the queue: one message per project and commit.
export function dedupeId(projectId: string, commitSha: string): string {
  return `${projectId}_${commitSha}`
}

// Plain-language reasons for the Drafts tab. A reason is a fixed code that the
// server wrote; anything else is shown generically.
export const JOB_REASONS: Record<string, string> = {
  daily_limit: 'You had already used your 10 drafts for the day.',
  monthly_cap: 'Drafting is paused for this month.',
  no_tag: 'The commit no longer had [post] in its message.',
  merge_commit: 'It was a merge commit, which is skipped.',
  project_gone: 'The project, the repository link or the switch had changed.',
  account_inactive: 'The account was no longer active.',
  commit_not_found: 'GitHub could not find the commit.',
  github_gone: 'Shipnote no longer had access to the repository.',
  github_retry: 'GitHub did not answer in time.',
  secret:
    'The commit message looked like it held a secret, so nothing was sent.',
  invalid_output: 'The draft did not pass the checks and was thrown away.',
  provider: 'The drafting service could not be reached.',
  no_content: 'There was nothing to write from.',
  queue_unavailable: 'The job could not be queued.',
  bad_job: 'The job was not valid.',
  failed: 'Something went wrong.',
}

export function jobReason(code: string | null): string {
  return (code && JOB_REASONS[code]) || JOB_REASONS.failed || ''
}
