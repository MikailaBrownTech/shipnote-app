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
  // HTTP status and QStash's own short error text, for the log only.
  readonly status: number | null
  readonly detail: string | null
  constructor(
    kind: QstashFailure,
    status: number | null = null,
    detail: string | null = null,
  ) {
    super(`QStash request failed: ${kind}`)
    this.name = 'QstashError'
    this.kind = kind
    this.status = status
    this.detail = detail
  }
}

// The address QStash calls with each job. Built from the configured site URL,
// never from a request. The worker checks a callback's signature against this
// exact string, so publishing and verifying must use the same function.
export function queueUrl(): string {
  return new URL('/api/queue/draft', env.NEXT_PUBLIC_SITE_URL).href
}

// QStash answers a refusal with {"error": "..."}: a short sentence about the
// request (a bad destination, a limit). It holds no secret and none of our
// data, but only the first 200 printable characters are kept.
async function errorText(response: Response): Promise<string | null> {
  try {
    const body: unknown = JSON.parse((await response.text()).slice(0, 2000))
    const text =
      typeof body === 'object' && body !== null && 'error' in body
        ? body.error
        : null
    return typeof text === 'string'
      ? text.replace(/[^ -~]/g, ' ').slice(0, 200)
      : null
  } catch {
    return null
  }
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
  const { status } = response
  const detail =
    (await errorText(response))?.replaceAll(
      settings.qstashToken,
      '[removed]',
    ) ?? null
  if (status === 401 || status === 403) {
    throw new QstashError('auth', status, detail)
  }
  if (status === 429) throw new QstashError('rate_limited', status, detail)
  if (status >= 500) throw new QstashError('unavailable', status, detail)
  throw new QstashError('rejected', status, detail)
}
