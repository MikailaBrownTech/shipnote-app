import 'server-only'
import { getAlertsEnv } from './env'
import { serverConfigWarnings } from './env-schema'

// Called once at server start (see src/instrumentation.ts). Throws, naming
// the variable, if ALERTS_ENABLED=true and the email settings are incomplete.
// Everything else that is misconfigured is logged once, names only.
export function assertServerConfig() {
  getAlertsEnv()

  const warnings = serverConfigWarnings(
    {
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    },
    {
      production:
        process.env.NODE_ENV === 'production' &&
        process.env.NEXT_PHASE !== 'phase-production-build',
      vercelProduction: process.env.VERCEL_ENV === 'production',
    },
  )
  for (const warning of warnings) {
    console.warn(`[shipnote config] WARNING: ${warning}`)
  }
}
