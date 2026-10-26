import 'server-only'
import { deviceHash, ipPrefix, userAgentFamily } from '@/lib/device'
import { getAlertsEnv } from './env'
import { sendSignInAlert } from './email'
import { recordSignInEvent } from './supabase-admin'

export type SignInInfo = {
  userId: string
  email: string | null
  method: 'github' | 'email'
  userAgent: string | null
  ip: string
}

type Deps = {
  config: typeof getAlertsEnv
  record: typeof recordSignInEvent
  send: typeof sendSignInAlert
  now: () => Date
  // Logs a fixed stage name only: no address, id, IP or provider message.
  logFailure: (stage: 'record' | 'send') => void
}

const defaults: Deps = {
  config: getAlertsEnv,
  record: recordSignInEvent,
  send: sendSignInAlert,
  now: () => new Date(),
  logFailure: (stage) => {
    console.error('sign-in alert failed', stage)
  },
}

// Runs after the response (Next's after()), so it never slows or blocks
// sign-in, and it never throws: a failure is logged without personal data.
// Does nothing while ALERTS_ENABLED is off.
export async function recordSignInAndAlert(
  info: SignInInfo,
  deps: Deps = defaults,
): Promise<void> {
  let recorded
  try {
    const config = deps.config()
    if (!config) return

    const family = userAgentFamily(info.userAgent)
    const prefix = ipPrefix(info.ip)
    recorded = await deps.record({
      userId: info.userId,
      method: info.method,
      ipPrefix: prefix,
      userAgentFamily: family,
      deviceHash: deviceHash(config.DEVICE_HASH_SALT, family, prefix),
      allowAlert: info.email !== null,
    })
    if (!recorded) {
      deps.logFailure('record')
      return
    }

    if (recorded.alert && info.email) {
      await deps.send({
        to: info.email,
        eventId: recorded.eventId,
        at: deps.now(),
        method: info.method,
        browser: family,
      })
    }
  } catch {
    deps.logFailure(recorded ? 'send' : 'record')
  }
}
