import { parseEnv } from './env-schema'

// Next only inlines NEXT_PUBLIC_* variables that are read by their literal
// name, so each one is spelled out here instead of passing process.env.
export const env = parseEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})
