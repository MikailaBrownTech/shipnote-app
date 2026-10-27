import { z } from 'zod'
import { DEFAULT_MODEL, modelConfig } from '@/lib/ai-models'

// Server-only variables. None start with NEXT_PUBLIC_, so Next never sends
// them to the browser. Each group is parsed when first used, so a page that
// does not need a group does not fail because it is unset.

const adminSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

const rateLimitSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url({ protocol: /^https$/ }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
})

// A bare address, or "Name <address>". Control characters (line breaks above
// all) are refused, because they could add headers to the outgoing mail.
export function isSender(value: string) {
  for (const char of value) {
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false
  }
  const address = /<([^<>]+)>$/.exec(value)?.[1] ?? value
  const parts = address.split('@')
  return (
    parts.length === 2 &&
    Boolean(parts[0]) &&
    (parts[1]?.includes('.') ?? false) &&
    !/\s|[<>,;]/.test(address)
  )
}

const alertsSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  // "alerts@example.com" or "Shipnote <alerts@example.com>". No line breaks,
  // which would let a value inject extra mail headers.
  EMAIL_FROM: z.string().max(200).refine(isSender),
  DEVICE_HASH_SALT: z.string().min(16),
})

type Source = Record<string, string | undefined>

// Messages name the variable and the problem, never the value.
function parseGroup<T extends z.ZodObject>(
  schema: T,
  source: Source,
): z.infer<T> {
  const result = schema.safeParse(source)
  if (result.success) return result.data

  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0])
    const raw = source[name]
    return raw === undefined || raw === ''
      ? `${name} is missing`
      : `${name} is invalid`
  })
  throw new Error(
    `Invalid server environment. Set these in .env.local (see .env.example):\n- ${problems.join('\n- ')}`,
  )
}

export function parseAdminEnv(source: Source) {
  return parseGroup(adminSchema, source)
}

// Returns null when rate limiting is not configured at all, so local
// development works without Redis. A half-set configuration still throws.
export function parseRateLimitEnv(source: Source) {
  if (!source.UPSTASH_REDIS_REST_URL && !source.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  return parseGroup(rateLimitSchema, source)
}

// Sign-in alert emails are off unless ALERTS_ENABLED=true. When on, every
// variable is required, and a missing one throws by name so the server fails
// at startup instead of quietly sending nothing.
export function parseAlertsEnv(source: Source) {
  const flag = source.ALERTS_ENABLED?.trim().toLowerCase()
  if (flag === undefined || flag === '' || flag === 'false') return null
  if (flag !== 'true') {
    throw new Error(
      'Invalid server environment:\n- ALERTS_ENABLED must be true or false',
    )
  }
  return parseGroup(alertsSchema, source)
}

export type ConfigContext = {
  // A running production server (not the build, not development).
  production: boolean
  // Deployed as a Vercel production deployment.
  vercelProduction: boolean
}

// Problems worth shouting about at startup that do not stop the server. Each
// line names variables only, never values.
export function serverConfigWarnings(
  source: Source,
  context: ConfigContext,
): string[] {
  const warnings: string[] = []
  const has = (name: string) => Boolean(source[name])

  if (context.production) {
    if (!has('SUPABASE_SERVICE_ROLE_KEY')) {
      warnings.push(
        'SUPABASE_SERVICE_ROLE_KEY is not set: every signed-in page and action will refuse requests until it is.',
      )
    }
    const url = has('UPSTASH_REDIS_REST_URL')
    const token = has('UPSTASH_REDIS_REST_TOKEN')
    if (!url && !token) {
      warnings.push(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set: sign-in rate limiting is OFF.',
      )
    } else if (!url || !token) {
      warnings.push(
        `${url ? 'UPSTASH_REDIS_REST_TOKEN' : 'UPSTASH_REDIS_REST_URL'} is not set: sign-in rate limiting is OFF until both Upstash variables are set.`,
      )
    }
  }

  if (context.vercelProduction) {
    const site = source.NEXT_PUBLIC_SITE_URL ?? ''
    let host = ''
    let https = false
    try {
      const parsed = new URL(site)
      host = parsed.hostname
      https = parsed.protocol === 'https:'
    } catch {
      // Unparseable: the public env check already reports it.
    }
    if (site && (!https || host === 'localhost' || host === '127.0.0.1')) {
      warnings.push(
        'NEXT_PUBLIC_SITE_URL is not the production https URL: sign-in redirects and cookies will point at the wrong origin.',
      )
    }
  }

  return warnings
}

// The GitHub App. Off unless GITHUB_ENABLED=true; when on, every variable is
// required and a missing or malformed one is named in the error (never its
// value). The private key is the PEM file, base64-encoded so it fits on one
// line in a host's environment settings.
export function decodePrivateKey(value: string): string | null {
  const pem = Buffer.from(value, 'base64').toString('utf8')
  return /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(pem) &&
    /-----END (?:RSA )?PRIVATE KEY-----/.test(pem)
    ? pem
    : null
}

const githubSchema = z.object({
  GITHUB_APP_ID: z.string().regex(/^\d{1,20}$/),
  // The slug in https://github.com/apps/<slug>. Used to build the install URL.
  GITHUB_APP_SLUG: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
  GITHUB_APP_CLIENT_ID: z.string().regex(/^[A-Za-z0-9._-]{4,100}$/),
  GITHUB_APP_CLIENT_SECRET: z.string().min(8).max(200),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(100)
    .refine((value) => decodePrivateKey(value) !== null),
})

export function isGithubEnabled(source: Source): boolean {
  return source.GITHUB_ENABLED?.trim().toLowerCase() === 'true'
}

// null while GITHUB_ENABLED is off. Throws, naming the variables, when it is on
// and something is missing or malformed.
export function parseGithubEnv(source: Source) {
  const flag = source.GITHUB_ENABLED?.trim().toLowerCase()
  if (flag === undefined || flag === '' || flag === 'false') return null
  if (flag !== 'true') {
    throw new Error(
      'Invalid server environment:\n- GITHUB_ENABLED must be true or false',
    )
  }
  const parsed = parseGroup(githubSchema, source)
  return {
    appId: parsed.GITHUB_APP_ID,
    slug: parsed.GITHUB_APP_SLUG,
    clientId: parsed.GITHUB_APP_CLIENT_ID,
    clientSecret: parsed.GITHUB_APP_CLIENT_SECRET,
    // refine() above guarantees this decodes.
    privateKeyPem: decodePrivateKey(parsed.GITHUB_APP_PRIVATE_KEY) ?? '',
  }
}

// Draft generation with Claude. Off unless AI_ENABLED=true; when on, the key is
// required and a missing or malformed variable is named in the error (never its
// value). The model must be one in src/lib/ai-models.ts, so its price is known.
const aiSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(20)
    .max(300)
    .regex(/^[\x21-\x7e]+$/),
  ANTHROPIC_MODEL: z.string().refine((value) => modelConfig(value) !== null),
  // Dollars, up to two decimals. Greater than zero.
  AI_MONTHLY_CAP_USD: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,2})?$/)
    .refine((value) => Number(value) > 0),
})

export function isAiEnabled(source: Source): boolean {
  return source.AI_ENABLED?.trim().toLowerCase() === 'true'
}

// null while AI_ENABLED is off. Throws, naming the variable, when it is on and
// something is missing or malformed.
export function parseAiEnv(source: Source) {
  const flag = source.AI_ENABLED?.trim().toLowerCase()
  if (flag === undefined || flag === '' || flag === 'false') return null
  if (flag !== 'true') {
    throw new Error(
      'Invalid server environment:\n- AI_ENABLED must be true or false',
    )
  }
  const parsed = parseGroup(aiSchema, {
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY?.trim(),
    ANTHROPIC_MODEL: source.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
    AI_MONTHLY_CAP_USD: source.AI_MONTHLY_CAP_USD?.trim() || '10',
  })
  return {
    apiKey: parsed.ANTHROPIC_API_KEY,
    model: parsed.ANTHROPIC_MODEL,
    monthlyCapMicrousd: Math.round(
      Number(parsed.AI_MONTHLY_CAP_USD) * 1_000_000,
    ),
  }
}
