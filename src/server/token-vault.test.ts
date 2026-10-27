import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { keyForVersion, openToken, parseKey, sealToken, VaultError } =
  await import('./token-vault')

const A = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const B = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'buf_access_TOKEN_value-0123456789'
const key = () => randomBytes(32)

describe('the token vault', () => {
  it('round-trips a token', () => {
    const k = key()
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: k })
    expect(openToken({ sealed, userId: A, key: k })).toBe(TOKEN)
  })

  it('round-trips odd text, including long and non-ASCII', () => {
    const k = key()
    for (const text of ['x', 'é日本語🙂', 'a'.repeat(5000), 'line\nbreak']) {
      const sealed = sealToken({ plaintext: text, userId: A, key: k })
      expect(openToken({ sealed, userId: A, key: k })).toBe(text)
    }
  })

  it('never contains the token, and is different each time', () => {
    const k = key()
    const one = sealToken({ plaintext: TOKEN, userId: A, key: k })
    const two = sealToken({ plaintext: TOKEN, userId: A, key: k })
    expect(one).not.toContain(TOKEN)
    expect(Buffer.from(one, 'base64url').toString('latin1')).not.toContain(
      TOKEN,
    )
    expect(one).not.toBe(two)
  })

  it('uses only URL-safe characters', () => {
    expect(sealToken({ plaintext: TOKEN, userId: A, key: key() })).toMatch(
      /^[A-Za-z0-9_-]+$/,
    )
  })

  it('a tampered value does not open, wherever it is changed', () => {
    const k = key()
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: k })
    const raw = Buffer.from(sealed, 'base64url')
    for (const at of [0, 5, 12, raw.length - 17, raw.length - 1]) {
      const copy = Buffer.from(raw)
      copy[at] = (copy[at] ?? 0) ^ 1
      expect(() =>
        openToken({ sealed: copy.toString('base64url'), userId: A, key: k }),
      ).toThrow(VaultError)
    }
  })

  it('a truncated or extended value does not open', () => {
    const k = key()
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: k })
    expect(() =>
      openToken({ sealed: sealed.slice(0, -4), userId: A, key: k }),
    ).toThrow(VaultError)
    expect(() =>
      openToken({ sealed: `${sealed}AAAA`, userId: A, key: k }),
    ).toThrow(VaultError)
  })

  it('a value sealed for user A does not open for user B', () => {
    const k = key()
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: k })
    expect(() => openToken({ sealed, userId: B, key: k })).toThrow(VaultError)
  })

  it('the wrong key does not open it', () => {
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: key() })
    expect(() => openToken({ sealed, userId: A, key: key() })).toThrow(
      VaultError,
    )
  })

  it.each(['', 'x', 'not base64 !!', 'AAAA'])(
    'garbage (%j) does not open',
    (sealed) => {
      expect(() => openToken({ sealed, userId: A, key: key() })).toThrow(
        VaultError,
      )
    },
  )

  it('an error carries no token, key or sealed text', () => {
    const k = key()
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: k })
    try {
      openToken({ sealed, userId: B, key: k })
      expect.unreachable()
    } catch (error) {
      const text = JSON.stringify(error) + String(error)
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(sealed)
      expect(text).not.toContain(k.toString('base64'))
      expect((error as Error).message).toBe(
        'Token vault: could not open a sealed value',
      )
    }
  })

  it('logs nothing', () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const k = key()
    const sealed = sealToken({ plaintext: TOKEN, userId: A, key: k })
    openToken({ sealed, userId: A, key: k })
    expect(() => openToken({ sealed, userId: B, key: k })).toThrow()
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([])
  })
})

describe('keys', () => {
  it('parses a base64 key of exactly 32 bytes', () => {
    const k = randomBytes(32)
    expect(parseKey(k.toString('base64'))?.equals(k)).toBe(true)
  })

  it.each([
    '',
    'short',
    randomBytes(16).toString('base64'),
    randomBytes(33).toString('base64'),
    'not base64 !!!',
    `${randomBytes(32).toString('base64')}\n`,
  ])('rejects a bad key (%j)', (value) => {
    expect(parseKey(value)).toBeNull()
  })

  it('finds a key by version, and a missing version gives none', () => {
    const one = key()
    const two = key()
    const keys = [
      { version: 2, key: two },
      { version: 1, key: one },
    ]
    expect(keyForVersion(keys, 1)).toBe(one)
    expect(keyForVersion(keys, 2)).toBe(two)
    expect(keyForVersion(keys, 3)).toBeNull()
  })
})
