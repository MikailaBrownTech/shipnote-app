import 'server-only'
import { env } from '@/lib/env'
import { getAlertsEnv } from './env'
import { buildSignInAlert, type AlertMethod } from './email-template'
import { outboundFetch } from './outbound'
import type { BrowserFamily } from '@/lib/device'

// The only module that talks to the email provider (Resend).

const ENDPOINT = 'https://api.resend.com/emails'

type Message = { to: string; subject: string; text: string; html: string }

async function send(message: Message, idempotencyKey: string) {
  const config = getAlertsEnv()
  if (!config) throw new Error('Alerts are not enabled')

  const response = await outboundFetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: config.EMAIL_FROM, ...message }),
  })
  // Only the status goes into the error: the body could echo the address.
  if (!response.ok) {
    throw new Error(`Email provider answered ${String(response.status)}`)
  }
}

export function sendSignInAlert(input: {
  to: string
  eventId: string
  at: Date
  method: AlertMethod
  browser: BrowserFamily
}) {
  const content = buildSignInAlert({
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
    at: input.at,
    method: input.method,
    browser: input.browser,
  })
  return send({ to: input.to, ...content }, `sign-in-alert-${input.eventId}`)
}
