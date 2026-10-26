import { z } from 'zod'

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
