import 'server-only'
import {
  isGithubEnabled,
  parseAdminEnv,
  parseAlertsEnv,
  parseGithubEnv,
  parseRateLimitEnv,
} from './env-schema'

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

// Whether the GitHub feature is on. Only reads the flag, so pages can hide the
// buttons without touching the other variables.
export function githubEnabled() {
  return isGithubEnabled({ GITHUB_ENABLED: process.env.GITHUB_ENABLED })
}

// null while GITHUB_ENABLED is off. Throws, naming the variable, when it is on
// and something is missing.
export function getGithubEnv() {
  return parseGithubEnv({
    GITHUB_ENABLED: process.env.GITHUB_ENABLED,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  })
}
