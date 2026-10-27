import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isSchedulingEnabled, parseSchedulingEnv } from './env-schema'

const KEY = randomBytes(32).toString('base64')
const OLD = randomBytes(32).toString('base64')
const on = {
  SCHEDULING_ENABLED: 'true',
  BUFFER_CLIENT_ID: 'client-id-123',
  BUFFER_CLIENT_SECRET: 'client-secret-456',
  BUFFER_TOKEN_ENCRYPTION_KEY: KEY,
}

function messageOf(source: Record<string, string | undefined>) {
  try {
    parseSchedulingEnv(source)
  } catch (error) {
    return (error as Error).message
  }
  return ''
}

describe('parseSchedulingEnv', () => {
  it('is null when the flag is off or unset, whatever else is set', () => {
    expect(parseSchedulingEnv({})).toBeNull()
    expect(parseSchedulingEnv({ SCHEDULING_ENABLED: 'false' })).toBeNull()
    expect(parseSchedulingEnv({ SCHEDULING_ENABLED: '' })).toBeNull()
    expect(
      parseSchedulingEnv({
        SCHEDULING_ENABLED: 'false',
        BUFFER_CLIENT_ID: 'junk',
      }),
    ).toBeNull()
  })

  it('rejects a flag that is neither true nor false', () => {
    expect(() => parseSchedulingEnv({ SCHEDULING_ENABLED: 'yes' })).toThrow(
      /SCHEDULING_ENABLED must be true or false/,
    )
  })

  it('returns the client and one key at version 1 by default', () => {
    const env = parseSchedulingEnv(on)
    expect(env?.clientId).toBe('client-id-123')
    expect(env?.clientSecret).toBe('client-secret-456')
    expect(env?.keys).toHaveLength(1)
    expect(env?.keys[0]?.version).toBe(1)
    expect(env?.keys[0]?.key.toString('base64')).toBe(KEY)
  })

  it.each([
    'BUFFER_CLIENT_ID',
    'BUFFER_CLIENT_SECRET',
    'BUFFER_TOKEN_ENCRYPTION_KEY',
  ])('names %s when it is missing', (name) => {
    expect(messageOf({ ...on, [name]: undefined })).toContain(
      `${name} is missing`,
    )
    expect(messageOf({ ...on, [name]: '  ' })).toContain(`${name} is missing`)
  })

  it.each([
    ['short', 'short'],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['not base64', 'not base64 !!!'],
  ])(
    'refuses an encryption key that is %s, naming it but not its value',
    (_label, bad) => {
      const message = messageOf({ ...on, BUFFER_TOKEN_ENCRYPTION_KEY: bad })
      expect(message).toContain('BUFFER_TOKEN_ENCRYPTION_KEY is invalid')
      expect(message).not.toContain(bad)
    },
  )

  it('never prints a value in an error', () => {
    const message = messageOf({ ...on, BUFFER_CLIENT_ID: undefined })
    expect(message).not.toContain('client-secret-456')
    expect(message).not.toContain(KEY)
  })

  it('refuses a client id or secret with spaces or control characters', () => {
    expect(messageOf({ ...on, BUFFER_CLIENT_ID: 'a b' })).toContain(
      'BUFFER_CLIENT_ID is invalid',
    )
    expect(messageOf({ ...on, BUFFER_CLIENT_SECRET: 'a\nb' })).toContain(
      'BUFFER_CLIENT_SECRET is invalid',
    )
  })

  describe('key rotation', () => {
    it('a higher version with the previous key gives both keys, newest first', () => {
      const env = parseSchedulingEnv({
        ...on,
        BUFFER_TOKEN_KEY_VERSION: '2',
        BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS: OLD,
      })
      expect(env?.keys.map((k) => k.version)).toEqual([2, 1])
      expect(env?.keys[1]?.key.toString('base64')).toBe(OLD)
    })

    it('a previous key needs a version of 2 or more', () => {
      expect(
        messageOf({ ...on, BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS: OLD }),
      ).toContain('BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS needs')
    })

    it.each(['0', '-1', 'abc', '1.5', '10000'])(
      'refuses the version %j',
      (version) => {
        expect(
          messageOf({ ...on, BUFFER_TOKEN_KEY_VERSION: version }),
        ).toContain('BUFFER_TOKEN_KEY_VERSION is invalid')
      },
    )

    it('refuses a malformed previous key', () => {
      expect(
        messageOf({
          ...on,
          BUFFER_TOKEN_KEY_VERSION: '2',
          BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'short',
        }),
      ).toContain('BUFFER_TOKEN_ENCRYPTION_KEY_PREVIOUS is invalid')
    })
  })
})

describe('isSchedulingEnabled', () => {
  it('reads only the flag', () => {
    expect(isSchedulingEnabled({ SCHEDULING_ENABLED: 'true' })).toBe(true)
    expect(isSchedulingEnabled({ SCHEDULING_ENABLED: ' TRUE ' })).toBe(true)
    expect(isSchedulingEnabled({ SCHEDULING_ENABLED: 'false' })).toBe(false)
    expect(isSchedulingEnabled({})).toBe(false)
  })
})
