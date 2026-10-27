import 'server-only'
import {
  isAiEnabled,
  isAutoDraftsEnabled,
  isSchedulingEnabled,
  isGithubEnabled,
  parseAiEnv,
  parseAdminEnv,
  parseAlertsEnv,
  parseAutoDraftsEnv,
  parseGithubEnv,
  parseRateLimitEnv,
  parseSchedulingEnv,
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

// Whether draft generation is on. Only reads the flag, so pages can hide the
// feature without touching the key.
export function aiEnabled() {
  return isAiEnabled({ AI_ENABLED: process.env.AI_ENABLED })
}

// null while AI_ENABLED is off. Throws, naming the variable, when it is on and
// something is missing or malformed.
export function getAiEnv() {
  return parseAiEnv({
    AI_ENABLED: process.env.AI_ENABLED,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    AI_MONTHLY_CAP_USD: process.env.AI_MONTHLY_CAP_USD,
  })
}

// Whether scheduling through Buffer is on (the kill switch). Only reads the
// flag, so pages can hide the feature without touching any secret.
export function schedulingEnabled() {
  return isSchedulingEnabled({
    SCHEDULING_ENABLED: process.env.SCHEDULING_ENABLED,
  })
}

// null while SCHEDULING_ENABLED is off. Throws, naming the variable, when it is
// on and something is missing or malformed.
export function getSchedulingEnv() {
  return parseSchedulingEnv({
    SCHEDULING_ENABLED: process.env.SCHEDULING_ENABLED,
    BUFFER_CLIENT_ID: process.env.BUFFER_CLIENT_ID,
    BUFFER_CLIENT_SECRET: process.env.BUFFER_CLIENT_SECRET,
    BUFFER_TOKEN_ENCRYPTION_KEY: process.env.BUFFER_TOKEN_ENCRYPTION_KEY,
    BUFFER_TOKEN_KEY_VERSION: process.env.BUFFER_TOKEN_KEY_VERSION,
    BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS:
      process.env.BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS,
  })
}

// Whether automatic drafts are on (the kill switch). Only reads the flag, so
// pages can hide the switch without touching any secret.
export function autoDraftsEnabled() {
  return isAutoDraftsEnabled({
    AUTO_DRAFTS_ENABLED: process.env.AUTO_DRAFTS_ENABLED,
  })
}

// null while AUTO_DRAFTS_ENABLED is off. Throws, naming the variable, when it is
// on and something is missing or malformed (GITHUB_ENABLED and AI_ENABLED must
// be on as well).
export function getAutoDraftsEnv() {
  return parseAutoDraftsEnv({
    AUTO_DRAFTS_ENABLED: process.env.AUTO_DRAFTS_ENABLED,
    GITHUB_ENABLED: process.env.GITHUB_ENABLED,
    AI_ENABLED: process.env.AI_ENABLED,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    QSTASH_TOKEN: process.env.QSTASH_TOKEN,
    QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY,
    QSTASH_URL: process.env.QSTASH_URL,
  })
}
