import { z } from 'zod'

const httpUrl = z.url({ protocol: /^https?$/ })

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: httpUrl.transform((url) => url.replace(/\/+$/, '')),
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

export type Env = z.infer<typeof schema>

type Source = Partial<Record<keyof Env, string | undefined>>

// Messages name the variable and the problem, never the value.
export function parseEnv(source: Source): Env {
  const result = schema.safeParse(source)
  if (result.success) return result.data

  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0])
    const raw = source[name as keyof Env]
    if (raw === undefined || raw === '') return `${name} is missing`
    return issue.code === 'invalid_format'
      ? `${name} must be an http(s) URL`
      : `${name} is invalid`
  })
  throw new Error(
    `Invalid environment (names only, see .env.example). Locally set these in .env.local. On a host such as Vercel add them under Project Settings > Environment Variables and redeploy: NEXT_PUBLIC_* values are read at build time.\n- ${problems.join('\n- ')}`,
  )
}
