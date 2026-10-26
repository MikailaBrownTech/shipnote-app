import 'server-only'
import { parseAdminEnv, parseRateLimitEnv } from './env-schema'

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
