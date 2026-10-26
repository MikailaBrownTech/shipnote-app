import { describe, expect, it } from 'vitest'
import { lastSignInAt, signedInWithin } from './auth-claims'

describe('lastSignInAt', () => {
  it('takes the newest real sign-in and ignores token refreshes', () => {
    expect(
      lastSignInAt([
        { method: 'otp', timestamp: 100 },
        { method: 'oauth', timestamp: 300 },
        { method: 'token_refresh', timestamp: 900 },
      ]),
    ).toBe(300)
  })

  it('returns null for missing or malformed claims', () => {
    expect(lastSignInAt(undefined)).toBeNull()
    expect(lastSignInAt('x')).toBeNull()
    expect(lastSignInAt([null, { method: 'otp' }, 4])).toBeNull()
    expect(lastSignInAt([{ method: 'token_refresh', timestamp: 5 }])).toBeNull()
  })
})

describe('signedInWithin', () => {
  const now = 10_000_000
  it('accepts a recent sign-in and rejects an old or unknown one', () => {
    expect(signedInWithin(now / 1000 - 599, 600, now)).toBe(true)
    expect(signedInWithin(now / 1000 - 601, 600, now)).toBe(false)
    expect(signedInWithin(null, 600, now)).toBe(false)
  })

  it('rejects a timestamp far in the future', () => {
    expect(signedInWithin(now / 1000 + 3600, 600, now)).toBe(false)
  })
})
