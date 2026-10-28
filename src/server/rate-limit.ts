import 'server-only'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { getRateLimitEnv } from './env'
import { allow, type Limiter } from './rate-limit-core'

// Sliding windows. Keys are chosen by the caller and must not hold raw
// personal data (hash emails first).
const LIMITS = {
  emailLinkIp: { tokens: 5, window: '15 m' },
  emailLinkEmail: { tokens: 3, window: '15 m' },
  signInStartIp: { tokens: 20, window: '15 m' },
  deleteAccount: { tokens: 5, window: '15 m' },
  projectCreate: { tokens: 10, window: '15 m' },
  projectUpdate: { tokens: 60, window: '15 m' },
  githubSetup: { tokens: 10, window: '15 m' },
  githubRepos: { tokens: 30, window: '15 m' },
  githubPrefill: { tokens: 20, window: '15 m' },
  githubLink: { tokens: 30, window: '15 m' },
  githubCommits: { tokens: 20, window: '10 m' },
  draftGenerate: { tokens: 6, window: '10 m' },
  draftEdit: { tokens: 60, window: '15 m' },
  voiceSave: { tokens: 20, window: '15 m' },
  autoDraftWebhook: { tokens: 60, window: '1 m' },
  bufferConnect: { tokens: 10, window: '15 m' },
  bufferSchedule: { tokens: 10, window: '15 m' },
  bufferCancel: { tokens: 30, window: '15 m' },
  bufferRefresh: { tokens: 6, window: '10 m' },
} as const

export type LimitName = keyof typeof LIMITS

const limiters = new Map<LimitName, Limiter | null>()
let failOpenCount = 0

function limiterFor(name: LimitName): Limiter | null {
  if (limiters.has(name)) return limiters.get(name) ?? null

  let limiter: Limiter | null = null
  const config = getRateLimitEnv()
  if (config) {
    const { tokens, window } = LIMITS[name]
    limiter = new Ratelimit({
      redis: new Redis({
        url: config.UPSTASH_REDIS_REST_URL,
        token: config.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `shipnote:rl:${name}`,
    })
  }
  limiters.set(name, limiter)
  return limiter
}

function noteFailOpen() {
  failOpenCount += 1
  console.warn('rate limiter unavailable, failing open', failOpenCount)
}

// True when the request may go ahead. Always awaited by callers.
export async function rateLimit(
  name: LimitName,
  key: string,
): Promise<boolean> {
  let limiter: Limiter | null
  try {
    limiter = limiterFor(name)
  } catch {
    // Misconfigured: allow, and say so without leaking any values.
    noteFailOpen()
    return true
  }
  return allow(limiter, key, { onFailOpen: noteFailOpen })
}
