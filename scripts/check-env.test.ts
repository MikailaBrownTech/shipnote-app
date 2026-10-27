import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./check-env.mjs', import.meta.url))

function run(env: Record<string, string>) {
  const result = spawnSync(process.execPath, [script], {
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  })
  return { code: result.status, out: result.stdout }
}

const publicVars = {
  NEXT_PUBLIC_SITE_URL: 'https://value-one.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://value-two.test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'value-three',
}

describe('check-env script', () => {
  it('fails and names what is missing', () => {
    const { code, out } = run({})
    expect(code).toBe(1)
    expect(out).toMatch(/MISSING NEXT_PUBLIC_SITE_URL/)
    expect(out).toMatch(/MISSING SUPABASE_SERVICE_ROLE_KEY/)
    expect(out).toMatch(/rate limiting is OFF/)
  })

  it('passes with the required variables, and never prints a value', () => {
    const { code, out } = run({
      ...publicVars,
      SUPABASE_SERVICE_ROLE_KEY: 'value-four',
    })
    expect(code).toBe(0)
    for (const value of [
      'value-one',
      'value-two',
      'value-three',
      'value-four',
    ]) {
      expect(out).not.toContain(value)
    }
  })

  it('requires the email variables only when alerts are on', () => {
    const base = { ...publicVars, SUPABASE_SERVICE_ROLE_KEY: 'k' }
    expect(run(base).code).toBe(0)
    const on = run({ ...base, ALERTS_ENABLED: 'true' })
    expect(on.code).toBe(1)
    expect(on.out).toMatch(/MISSING RESEND_API_KEY/)
  })

  it('flags a secret named with NEXT_PUBLIC_', () => {
    const { code, out } = run({
      ...publicVars,
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      NEXT_PUBLIC_UPSTASH_TOKEN: 'x',
    })
    expect(code).toBe(1)
    expect(out).toMatch(
      /must not start with NEXT_PUBLIC_: NEXT_PUBLIC_UPSTASH_TOKEN/,
    )
  })
})
