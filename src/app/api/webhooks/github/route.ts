import { connection, NextResponse, type NextRequest } from 'next/server'
import { MAX_WEBHOOK_BYTES } from '@/lib/auto-draft-job'
import {
  handlePush,
  parsePush,
  readBoundedBody,
  type PushOutcome,
} from '@/server/auto-draft-webhook'
import { autoDraftsConfig, autoDraftsOn } from '@/server/auto-drafts'
import { rateLimit } from '@/server/rate-limit'
import {
  isWellFormedGithubSignature,
  verifyGithubSignature,
} from '@/server/webhook-verify'

// GitHub's webhook for the App: a push to a linked repository. This is a public
// address, so nothing is done for a request until it proves it came from GitHub.
//
// The order is the point: size cap, then the signature (shape, then HMAC over
// the raw bytes, constant time), and only then is the body parsed or any
// database touched. A missing or bad signature is a 401 with no writes. The
// answers are short and generic, and nothing from the request is logged.
//
// The proxy skips /api/webhooks, so no session cookie is read or set here.

const reply = (status: number, body: Record<string, unknown> = {}) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

const DELIVERY = /^[A-Za-z0-9-]{8,64}$/

const outcomeStatus: Record<PushOutcome, number> = {
  ignored: 200,
  duplicate: 200,
  queued: 202,
  // GitHub does not retry by itself; a 503 shows the delivery as failed so it
  // can be redelivered from the App's advanced settings.
  unavailable: 503,
}

export async function POST(request: NextRequest) {
  // Always a per-request response, so a build with the feature off cannot
  // prerender the 404 below as a static file.
  await connection()

  if (!autoDraftsOn()) return new NextResponse(null, { status: 404 })
  const settings = autoDraftsConfig()
  if (!settings) return new NextResponse(null, { status: 404 })

  // 1. Size, from the declared length, before reading anything.
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_WEBHOOK_BYTES) {
    return reply(413)
  }

  // 2. The signature header must be well formed before the body is read.
  const header = request.headers.get('x-hub-signature-256')
  if (!isWellFormedGithubSignature(header)) return reply(401)

  // 3. The raw body, never more than the cap, then the HMAC over those bytes.
  const raw = await readBoundedBody(request, MAX_WEBHOOK_BYTES)
  if (raw === 'too_large') return reply(413)
  if (raw === 'failed') return reply(400)
  if (
    !verifyGithubSignature({
      header,
      rawBody: raw,
      secret: settings.webhookSecret,
    })
  ) {
    return reply(401)
  }

  // Signed by GitHub from here on. Anything but a push is acknowledged and
  // ignored (a ping when the webhook is set up, for one).
  const event = request.headers.get('x-github-event')
  if (event !== 'push') {
    console.warn('auto drafts: event ignored', event === 'ping' ? 'ping' : 'other')
    return reply(200, { ok: true, ignored: 'not_push' })
  }
  const deliveryId = request.headers.get('x-github-delivery')
  if (!deliveryId || !DELIVERY.test(deliveryId)) return reply(400)

  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return reply(400)
  }
  const payload = parsePush(body)
  if (!payload) return reply(400)

  // A brake per installation (fail open: it is only an extra).
  if (!(await rateLimit('autoDraftWebhook', String(payload.installation.id)))) {
    return reply(429)
  }

  const { outcome, reason } = await handlePush(payload, deliveryId)
  // A fixed code only, so a 200 that did nothing says why in Recent deliveries
  // and in the logs.
  if (reason) console.warn('auto drafts: push ignored', reason)
  return reply(outcomeStatus[outcome], {
    ok: outcome !== 'unavailable',
    ...(reason ? { ignored: reason } : {}),
  })
}
