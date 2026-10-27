import 'server-only'
import { env } from '@/lib/env'
import {
  dedupeId,
  QUEUE_RETRIES,
  type AutoDraftJob,
} from '@/lib/auto-draft-job'
import { getAutoDraftsEnv } from './env'
import { outboundFetch } from './outbound'

// Publishes one automatic-draft job to QStash. The message holds identifiers
// only (see auto-draft-job.ts). Nothing here logs, and errors carry a fixed
// kind: never the token, the body, or what QStash answered.

export type QstashFailure =
  | 'disabled'
  | 'auth' // 401 or 403: the token
  | 'rejected' // 400 and other client errors
  | 'rate_limited'
  | 'unavailable'

export class QstashError extends Error {
  readonly kind: QstashFailure
  constructor(kind: QstashFailure) {
    super(`QStash request failed: ${kind}`)
    this.name = 'QstashError'
    this.kind = kind
  }
}

// The address QStash calls with each job. Built from the configured site URL,
// never from a request. The worker checks a callback's signature against this
// exact string, so publishing and verifying must use the same function.
export function queueUrl(): string {
  return new URL('/api/queue/draft', env.NEXT_PUBLIC_SITE_URL).href
}

export async function publishAutoDraftJob(job: AutoDraftJob): Promise<void> {
  const settings = getAutoDraftsEnv()
  if (!settings) throw new QstashError('disabled')

  let response: Response
  try {
    response = await outboundFetch(
      `${settings.qstashUrl}/v2/publish/${queueUrl()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Method': 'POST',
          // Total deliveries = 1 + retries; the worker says when not to retry.
          'Upstash-Retries': String(QUEUE_RETRIES),
          // A duplicate publish within ten minutes is ignored by QStash. The
          // unique (project, commit) job row is what holds beyond that.
          'Upstash-Deduplication-Id': dedupeId(job.projectId, job.commitSha),
        },
        body: JSON.stringify(job),
        timeoutMs: 5000,
      },
    )
  } catch {
    throw new QstashError('unavailable')
  }
  if (response.ok) return
  if (response.status === 401 || response.status === 403) {
    throw new QstashError('auth')
  }
  if (response.status === 429) throw new QstashError('rate_limited')
  if (response.status >= 500) throw new QstashError('unavailable')
  throw new QstashError('rejected')
}
