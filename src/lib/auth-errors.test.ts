import { describe, expect, it } from 'vitest'
import {
  callbackErrorCode,
  isInviteRefusal,
  parseSignInError,
} from './auth-errors'

const params = (query: string) => new URLSearchParams(query)

describe('callbackErrorCode', () => {
  it('recognises the invite-only refusal', () => {
    expect(
      callbackErrorCode(
        params('error=server_error&error_description=Sign-up+is+invite+only.'),
      ),
    ).toBe('invite')
  })

  it('recognises an expired link', () => {
    expect(
      callbackErrorCode(params('error=access_denied&error_code=otp_expired')),
    ).toBe('expired')
  })

  it('recognises access denied at GitHub', () => {
    expect(callbackErrorCode(params('error=access_denied'))).toBe('denied')
  })

  it('falls back to a generic failure', () => {
    expect(callbackErrorCode(params('error=whatever'))).toBe('failed')
    expect(callbackErrorCode(params(''))).toBe('failed')
  })
})

describe('parseSignInError', () => {
  it('only passes known codes through', () => {
    expect(parseSignInError('invite')).toBe('invite')
    expect(parseSignInError('<script>')).toBeNull()
    expect(parseSignInError(undefined)).toBeNull()
  })
})

describe('isInviteRefusal', () => {
  it('matches the hook message case-insensitively', () => {
    expect(isInviteRefusal({ message: 'Sign-up is INVITE ONLY.' })).toBe(true)
    expect(isInviteRefusal({ message: 'rate limit' })).toBe(false)
    expect(isInviteRefusal(null)).toBe(false)
  })
})
