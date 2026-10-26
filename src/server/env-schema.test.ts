import { describe, expect, it } from 'vitest'
import { parseAdminEnv, parseRateLimitEnv } from './env-schema'

describe('parseAdminEnv', () => {
  it('accepts a key', () => {
    expect(parseAdminEnv({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: 'k',
    })
  })

  it('names the missing variable and nothing else', () => {
    expect(() => parseAdminEnv({})).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY is missing/,
    )
  })
})

describe('parseRateLimitEnv', () => {
  it('is null when neither variable is set', () => {
    expect(parseRateLimitEnv({})).toBeNull()
  })

  it('throws on a half-set configuration without echoing values', () => {
    const secret = 'super-secret-token'
    expect(() =>
      parseRateLimitEnv({ UPSTASH_REDIS_REST_TOKEN: secret }),
    ).toThrow(/UPSTASH_REDIS_REST_URL is missing/)
    try {
      parseRateLimitEnv({ UPSTASH_REDIS_REST_TOKEN: secret })
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })
})
