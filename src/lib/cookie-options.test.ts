import { describe, expect, it } from 'vitest'
import {
  sessionCookieOptions,
  withSessionCookieOptions,
} from './cookie-options'

describe('sessionCookieOptions', () => {
  it('is Secure, HttpOnly, Lax and path / in production', () => {
    expect(sessionCookieOptions(true)).toEqual({
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    })
  })

  it('relaxes only Secure in development (plain http://localhost)', () => {
    expect(sessionCookieOptions(false)).toEqual({
      path: '/',
      sameSite: 'lax',
      secure: false,
      httpOnly: true,
    })
  })

  it('reads NODE_ENV when not told', () => {
    // Vitest runs with NODE_ENV=test, which is not production.
    expect(sessionCookieOptions().secure).toBe(false)
  })
})

describe('withSessionCookieOptions', () => {
  it('keeps what the client set, such as maxAge', () => {
    expect(withSessionCookieOptions({ maxAge: 60 }, true)).toMatchObject({
      maxAge: 60,
      secure: true,
      httpOnly: true,
    })
  })

  it('cannot be weakened by the options passed in', () => {
    const weak = {
      httpOnly: false,
      secure: false,
      sameSite: 'none',
      path: '/x',
    } as const
    expect(withSessionCookieOptions(weak, true)).toEqual({
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    })
  })

  it('works with no options at all', () => {
    expect(withSessionCookieOptions(undefined, true).httpOnly).toBe(true)
  })
})
