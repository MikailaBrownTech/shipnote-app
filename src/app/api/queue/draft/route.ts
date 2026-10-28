import { connection, NextResponse, type NextRequest } from 'next/server'
import { autoDraftJob, MAX_JOB_BYTES } from '@/lib/auto-draft-job'
import { runAutoDraftJob } from '@/server/auto-draft-worker'
import { readBoundedBody } from '@/server/auto-draft-webhook'
import { autoDraftsConfig, autoDraftsOn } from '@/server/auto-drafts'
import { queueUrl } from '@/server/qstash'
import { verifyQstashSignature } from '@/server/webhook-verify'

// QStash's callback: one automatic draft. A public address, so nothing is done
// until the request proves it came from QStash: the Upstash-Signature JWT must
// verify (current or next signing key), be for this exact URL, be unexpired, and
// carry the SHA-256 of the raw body. Only then is the body read as data, checked
// strictly, and the job claimed (once).
//
// How the answers are used by QStash: 2xx is success (no retry), 489 with
// Upstash-NonRetryable-Error stops retries, and anything else is retried.
//
// The proxy skips /api/queue, so no session cookie is read or set here.

// A draft makes one call to Claude (up to 30 seconds) after two to GitHub.
export const maxDuration = 60

const reply = (status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(
    { ok: status < 400 },
    { status, headers: { 'Cache-Control': 'private, no-store', ...headers } },
  )

// "Stop retrying this message." Documented by Upstash: status 489 with this
// header marks the message failed and sends it to the dead letter queue.
const nonRetryable = () => reply(489, { 'Upstash-NonRetryable-Error': 'true' })

export async function POST(request: NextRequest) {
  // Always a per-request response, so a build with the feature off cannot
  // prerender the 404 below as a static file.
  await connection()

  if (!autoDraftsOn()) return new NextResponse(null, { status: 404 })
  const settings = autoDraftsConfig()
  if (!settings) return new NextResponse(null, { status: 404 })

  // 1. Size and the presence of a signature, before anything is read.
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_JOB_BYTES) {
    return new NextResponse(null, { status: 413 })
  }
  const signature = request.headers.get('upstash-signature')
  if (!signature) return new NextResponse(null, { status: 401 })

  // 2. The raw body, capped, then the signature over those bytes and this URL.
  const raw = await readBoundedBody(request, MAX_JOB_BYTES)
  if (raw === 'too_large') return new NextResponse(null, { status: 413 })
  if (raw === 'failed') return new NextResponse(null, { status: 400 })
  if (
    !verifyQstashSignature({
      signature,
      rawBody: raw,
      url: queueUrl(),
      keys: settings.signingKeys,
    })
  ) {
    return new NextResponse(null, { status: 401 })
  }

  // 3. Signed by QStash. Now it is data, and it must be exactly the message we
  //    publish. A signed message that is not is our own bug: do not retry it.
  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return nonRetryable()
  }
  const parsed = autoDraftJob.safeParse(body)
  if (!parsed.success) return nonRetryable()

  // 4. Claim the job once and run it.
  const retriedHeader = request.headers.get('upstash-retried')
  const retried = /^\d{1,2}$/.test(retriedHeader ?? '')
    ? Number(retriedHeader)
    : 0
  const outcome = await runAutoDraftJob(parsed.data, retried)

  if (outcome === 'retry') return reply(503)
  if (outcome === 'failed') return nonRetryable()
  return reply(200)
}
