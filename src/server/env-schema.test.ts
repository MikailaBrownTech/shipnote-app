import { describe, expect, it } from 'vitest'
import {
  isSender,
  parseAdminEnv,
  parseAlertsEnv,
  parseRateLimitEnv,
} from './env-schema'

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

describe('parseAlertsEnv', () => {
  const full = {
    ALERTS_ENABLED: 'true',
    RESEND_API_KEY: 're_x',
    EMAIL_FROM: 'Shipnote <alerts@example.com>',
    DEVICE_HASH_SALT: 'a-long-enough-test-salt',
  }

  it('is off by default and when false', () => {
    expect(parseAlertsEnv({})).toBeNull()
    expect(parseAlertsEnv({ ALERTS_ENABLED: 'false' })).toBeNull()
  })

  it('accepts a complete configuration', () => {
    expect(parseAlertsEnv(full)?.EMAIL_FROM).toBe(full.EMAIL_FROM)
  })

  it.each(['RESEND_API_KEY', 'EMAIL_FROM', 'DEVICE_HASH_SALT'])(
    'names %s when it is missing',
    (name) => {
      expect(() => parseAlertsEnv({ ...full, [name]: undefined })).toThrow(
        new RegExp(`${name} is missing`),
      )
    },
  )

  it('rejects an unknown flag value and a short salt', () => {
    expect(() => parseAlertsEnv({ ...full, ALERTS_ENABLED: 'yes' })).toThrow(
      /ALERTS_ENABLED/,
    )
    expect(() =>
      parseAlertsEnv({ ...full, DEVICE_HASH_SALT: 'short' }),
    ).toThrow(/DEVICE_HASH_SALT is invalid/)
  })

  it('rejects a sender that could inject headers', () => {
    const evil = 'a@example.com\r\nBcc: x@example.com'
    expect(() => parseAlertsEnv({ ...full, EMAIL_FROM: evil })).toThrow(
      /EMAIL_FROM is invalid/,
    )
    expect(isSender('not-an-address')).toBe(false)
    expect(isSender('a@example.com')).toBe(true)
  })
})
