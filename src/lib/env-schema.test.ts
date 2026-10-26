import { describe, expect, it } from 'vitest'
import { parseEnv } from './env-schema'

const valid = {
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000/',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
}

describe('parseEnv', () => {
  it('accepts a valid config and trims the trailing slash on the site URL', () => {
    expect(parseEnv(valid).NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000')
  })

  it('names every missing variable', () => {
    expect(() => parseEnv({})).toThrowError(
      /NEXT_PUBLIC_SITE_URL is missing[\s\S]*NEXT_PUBLIC_SUPABASE_URL is missing[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing/,
    )
  })

  it('treats an empty string as missing', () => {
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_SITE_URL: '' })).toThrowError(
      /NEXT_PUBLIC_SITE_URL is missing/,
    )
  })

  it('rejects a non-URL without printing the value', () => {
    const bad = 'not-a-url-secret-value'
    let message = ''
    try {
      parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: bad })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL must be an http\(s\) URL/)
    expect(message).not.toContain(bad)
  })

  it('rejects a non-http URL', () => {
    expect(() =>
      parseEnv({ ...valid, NEXT_PUBLIC_SITE_URL: 'ftp://example.com' }),
    ).toThrowError(/NEXT_PUBLIC_SITE_URL must be an http\(s\) URL/)
  })
})
