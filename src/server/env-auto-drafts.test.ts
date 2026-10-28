import { describe, expect, it } from 'vitest'
import { isAutoDraftsEnabled, parseAutoDraftsEnv } from './env-schema'

const base = {
  AUTO_DRAFTS_ENABLED: 'true',
  GITHUB_ENABLED: 'true',
  AI_ENABLED: 'true',
  GITHUB_WEBHOOK_SECRET: 'webhook-secret-0123456789',
  QSTASH_TOKEN: 'qstash-token-0123456789',
  QSTASH_CURRENT_SIGNING_KEY: 'sig_current_0123456789',
  QSTASH_NEXT_SIGNING_KEY: 'sig_next_0123456789',
}

function messageOf(source: Record<string, string | undefined>) {
  try {
    parseAutoDraftsEnv(source)
  } catch (error) {
    return (error as Error).message
  }
  return ''
}

describe('parseAutoDraftsEnv', () => {
  it('is null when the flag is off or unset, whatever else is set', () => {
    expect(parseAutoDraftsEnv({})).toBeNull()
    expect(parseAutoDraftsEnv({ AUTO_DRAFTS_ENABLED: 'false' })).toBeNull()
    expect(parseAutoDraftsEnv({ AUTO_DRAFTS_ENABLED: '' })).toBeNull()
    expect(
      parseAutoDraftsEnv({
        AUTO_DRAFTS_ENABLED: 'false',
        QSTASH_TOKEN: 'junk',
      }),
    ).toBeNull()
  })

  it('rejects a flag that is neither true nor false', () => {
    expect(messageOf({ AUTO_DRAFTS_ENABLED: 'yes' })).toContain(
      'AUTO_DRAFTS_ENABLED must be true or false',
    )
  })

  it('returns the secret, the token, both signing keys in order, and the default host', () => {
    expect(parseAutoDraftsEnv(base)).toEqual({
      webhookSecret: 'webhook-secret-0123456789',
      qstashToken: 'qstash-token-0123456789',
      signingKeys: ['sig_current_0123456789', 'sig_next_0123456789'],
      qstashUrl: 'https://qstash.upstash.io',
    })
  })

  it.each([
    'GITHUB_WEBHOOK_SECRET',
    'QSTASH_TOKEN',
    'QSTASH_CURRENT_SIGNING_KEY',
    'QSTASH_NEXT_SIGNING_KEY',
  ])('names %s when it is missing or blank', (name) => {
    expect(messageOf({ ...base, [name]: undefined })).toContain(
      `${name} is missing`,
    )
    expect(messageOf({ ...base, [name]: '   ' })).toContain(
      `${name} is missing`,
    )
  })

  it('needs GITHUB_ENABLED and AI_ENABLED, and says which', () => {
    expect(messageOf({ ...base, GITHUB_ENABLED: 'false' })).toContain(
      'needs GITHUB_ENABLED to be true',
    )
    expect(messageOf({ ...base, AI_ENABLED: undefined })).toContain(
      'needs AI_ENABLED to be true',
    )
    expect(
      messageOf({ ...base, GITHUB_ENABLED: undefined, AI_ENABLED: undefined }),
    ).toContain('GITHUB_ENABLED and AI_ENABLED')
  })

  it.each([
    [
      'a short webhook secret',
      { GITHUB_WEBHOOK_SECRET: 'short' },
      'GITHUB_WEBHOOK_SECRET',
    ],
    [
      'a webhook secret with a space',
      { GITHUB_WEBHOOK_SECRET: 'has a space in it 1234' },
      'GITHUB_WEBHOOK_SECRET',
    ],
    [
      'a signing key with a line break',
      { QSTASH_CURRENT_SIGNING_KEY: 'sig_current\n0123456789' },
      'QSTASH_CURRENT_SIGNING_KEY',
    ],
    [
      'a short next key',
      { QSTASH_NEXT_SIGNING_KEY: 'tiny' },
      'QSTASH_NEXT_SIGNING_KEY',
    ],
    [
      'a token with a control character',
      { QSTASH_TOKEN: 'qstash\u0000token0123' },
      'QSTASH_TOKEN',
    ],
  ])('refuses %s, naming it but not its value', (_label, over, name) => {
    const message = messageOf({ ...base, ...over })
    expect(message).toContain(`${name} is invalid`)
    for (const value of Object.values(over))
      expect(message).not.toContain(value)
  })

  it('never prints a value in an error', () => {
    const message = messageOf({ ...base, QSTASH_TOKEN: undefined })
    for (const value of Object.values(base)) {
      if (value !== 'true') expect(message).not.toContain(value)
    }
  })

  describe('the QStash address', () => {
    it.each([
      'https://qstash.upstash.io',
      'https://qstash-us-east-1.upstash.io',
      'https://qstash-eu-central-1.upstash.io/',
    ])('accepts %s', (url) => {
      expect(parseAutoDraftsEnv({ ...base, QSTASH_URL: url })?.qstashUrl).toBe(
        url.replace(/\/$/, ''),
      )
    })

    it.each([
      'http://qstash.upstash.io',
      'https://qstash.upstash.io.evil.test',
      'https://evil.test',
      'https://qstash.upstash.io/v2',
      'qstash.upstash.io',
    ])('refuses %s', (url) => {
      expect(messageOf({ ...base, QSTASH_URL: url })).toContain(
        'QSTASH_URL is invalid',
      )
    })

    it('an empty value means the default', () => {
      expect(parseAutoDraftsEnv({ ...base, QSTASH_URL: '' })?.qstashUrl).toBe(
        'https://qstash.upstash.io',
      )
    })
  })
})

describe('isAutoDraftsEnabled', () => {
  it('reads only the flag', () => {
    expect(isAutoDraftsEnabled({ AUTO_DRAFTS_ENABLED: 'true' })).toBe(true)
    expect(isAutoDraftsEnabled({ AUTO_DRAFTS_ENABLED: ' TRUE ' })).toBe(true)
    expect(isAutoDraftsEnabled({ AUTO_DRAFTS_ENABLED: 'false' })).toBe(false)
    expect(isAutoDraftsEnabled({})).toBe(false)
  })
})
