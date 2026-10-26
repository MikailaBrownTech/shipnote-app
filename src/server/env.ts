import 'server-only'
import { parseAdminEnv, parseAlertsEnv, parseRateLimitEnv } from './env-schema'

export function getAdminEnv() {
  return parseAdminEnv({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
}

export function getRateLimitEnv() {
  return parseRateLimitEnv({
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
}

// null while ALERTS_ENABLED is off. Throws, naming the variable, when it is on
// and something is missing.
export function getAlertsEnv() {
  return parseAlertsEnv({
    ALERTS_ENABLED: process.env.ALERTS_ENABLED,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    DEVICE_HASH_SALT: process.env.DEVICE_HASH_SALT,
  })
}
