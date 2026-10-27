// Compares the variable NAMES in .env.example with process.env and reports
// what is missing. It never prints a value. Exit code 1 if a required
// variable is missing.
//
//   pnpm check:env
//   node --env-file=.env.local scripts/check-env.mjs   # check a file instead
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const exampleFile = fileURLToPath(new URL('../.env.example', import.meta.url))

// Keep in step with src/lib/env-schema.ts and src/server/env-schema.ts.
const PUBLIC = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]
const REQUIRED = ['SUPABASE_SERVICE_ROLE_KEY']
const OPTIONAL = [
  'UPSTASH_REDIS_REST_URL', // rate limiting is off without both
  'UPSTASH_REDIS_REST_TOKEN',
  'ALERTS_ENABLED', // defaults to false
  'GITHUB_ENABLED', // defaults to false
  'AI_ENABLED', // defaults to false
  'ANTHROPIC_MODEL', // defaults to claude-sonnet-5-5
  'AI_MONTHLY_CAP_USD', // defaults to 10
]
// Required only while ALERTS_ENABLED=true.
const WHEN_ALERTS = ['RESEND_API_KEY', 'EMAIL_FROM', 'DEVICE_HASH_SALT']
// Required only while AI_ENABLED=true.
const WHEN_AI = ['ANTHROPIC_API_KEY']
// Required only while GITHUB_ENABLED=true.
const WHEN_GITHUB = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
]

const isSet = (name) => Boolean(process.env[name]?.trim())
const alertsOn = process.env.ALERTS_ENABLED?.trim().toLowerCase() === 'true'
const githubOn = process.env.GITHUB_ENABLED?.trim().toLowerCase() === 'true'
const aiOn = process.env.AI_ENABLED?.trim().toLowerCase() === 'true'

const exampleNames = readFileSync(exampleFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
  .filter(Boolean)
const known = new Set([
  ...PUBLIC,
  ...REQUIRED,
  ...OPTIONAL,
  ...WHEN_ALERTS,
  ...WHEN_GITHUB,
  ...WHEN_AI,
])

let failed = false
function section(title, names, { required }) {
  console.log(`\n${title}`)
  for (const name of names) {
    const ok = isSet(name)
    if (!ok && required) failed = true
    console.log(
      `  ${ok ? 'set    ' : required ? 'MISSING' : 'unset  '} ${name}`,
    )
  }
}

section('Public (required; read at build time)', PUBLIC, { required: true })
section('Server-only, required', REQUIRED, { required: true })
section('Server-only, optional', OPTIONAL, { required: false })
section(
  `Server-only, required only when ALERTS_ENABLED=true (currently ${alertsOn ? 'on' : 'off'})`,
  WHEN_ALERTS,
  { required: alertsOn },
)
section(
  `Server-only, required only when GITHUB_ENABLED=true (currently ${githubOn ? 'on' : 'off'})`,
  WHEN_GITHUB,
  { required: githubOn },
)
section(
  `Server-only, required only when AI_ENABLED=true (currently ${aiOn ? 'on' : 'off'})`,
  WHEN_AI,
  { required: aiOn },
)

const upstash = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']
const upstashSet = upstash.filter(isSet).length
if (upstashSet === 0) {
  console.log(
    '\nNote: Upstash is not configured, so sign-in rate limiting is OFF.',
  )
} else if (upstashSet === 1) {
  console.log(
    '\nNote: only one Upstash variable is set, so rate limiting is OFF.',
  )
}

const drift = [
  ...exampleNames.filter((name) => !known.has(name)),
  ...[...known].filter((name) => !exampleNames.includes(name)),
]
if (drift.length > 0) {
  console.log(
    `\nNames out of step between .env.example and this script: ${drift.join(', ')}`,
  )
  failed = true
}

const leaked = Object.keys(process.env).filter(
  (name) =>
    name.startsWith('NEXT_PUBLIC_') &&
    /SERVICE_ROLE|SECRET|TOKEN|SALT|RESEND|UPSTASH|PRIVATE_KEY|GITHUB_APP|ANTHROPIC/.test(
      name,
    ),
)
if (leaked.length > 0) {
  console.log(
    `\nServer-only secrets must not start with NEXT_PUBLIC_: ${leaked.join(', ')}`,
  )
  failed = true
}

console.log(failed ? '\nResult: problems found.' : '\nResult: ok.')
process.exit(failed ? 1 : 0)
