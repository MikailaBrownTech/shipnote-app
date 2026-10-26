import { describe, expect, it } from 'vitest'
import { checkGithubSignIn, type CallbackUser } from './github-verified'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const justNow = new Date(NOW - 5_000).toISOString()
const longAgo = new Date(NOW - 30 * 86_400_000).toISOString()

function user(
  identityData: Record<string, unknown>,
  extra: Partial<CallbackUser> = {},
): CallbackUser {
  return {
    created_at: justNow,
    identities: [
      {
        provider: 'github',
        last_sign_in_at: justNow,
        identity_data: identityData,
      },
    ],
    ...extra,
  }
}

describe('checkGithubSignIn', () => {
  it('accepts a verified email', () => {
    expect(checkGithubSignIn(user({ email_verified: true }), NOW)).toBe('ok')
  })

  it('falls back to the user-level flag when the identity has none', () => {
    expect(
      checkGithubSignIn(
        user({}, { user_metadata: { email_verified: true } }),
        NOW,
      ),
    ).toBe('ok')
  })

  it.each([
    ['missing', {}],
    ['false', { email_verified: false }],
    ['a string', { email_verified: 'true' }],
  ])('fails closed when the flag is %s', (_label, data) => {
    expect(checkGithubSignIn(user(data), NOW)).toBe('deny-and-delete')
  })

  it('does not trust the user-level flag over a false identity flag', () => {
    expect(
      checkGithubSignIn(
        user(
          { email_verified: false },
          { user_metadata: { email_verified: true } },
        ),
        NOW,
      ),
    ).toBe('deny-and-delete')
  })

  it('never deletes an older account, only signs it out', () => {
    expect(checkGithubSignIn(user({}, { created_at: longAgo }), NOW)).toBe(
      'deny',
    )
  })

  it('never deletes an account that also has another identity', () => {
    const both = user({})
    both.identities?.push({ provider: 'email' })
    expect(checkGithubSignIn(both, NOW)).toBe('deny')
  })

  it('ignores sign-ins that were not through GitHub', () => {
    expect(
      checkGithubSignIn(
        { created_at: justNow, identities: [{ provider: 'email' }] },
        NOW,
      ),
    ).toBe('not-github')
    expect(
      checkGithubSignIn(
        user(
          {},
          { identities: [{ provider: 'github', last_sign_in_at: longAgo }] },
        ),
        NOW,
      ),
    ).toBe('not-github')
  })
})
