import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const {
  isWellFormedGithubSignature,
  verifyGithubSignature,
  verifyQstashSignature,
} = await import('./webhook-verify')

const URL_ = 'https://shipnote.test/api/queue/draft'
const NOW = 1_800_000_000_000
const SEC = Math.floor(NOW / 1000)
const CURRENT = 'current-signing-key-0123456789'
const NEXT = 'next-signing-key-0123456789'
const BODY = Buffer.from('{"projectId":"p","userId":"u"}')

describe('GitHub signature', () => {
  const secret = "It's a Secret to Everybody"
  const payload = Buffer.from('Hello, World!')
  const good =
    'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17'

  it('accepts GitHub’s own documented test vector', () => {
    expect(
      verifyGithubSignature({ header: good, rawBody: payload, secret }),
    ).toBe(true)
  })

  it('accepts a signature computed over the raw bytes', () => {
    const body = Buffer.from('{"a":"é日本語"}', 'utf8')
    const header = `sha256=${createHmac('sha256', 'topsecret-0123456789').update(body).digest('hex')}`
    expect(
      verifyGithubSignature({
        header,
        rawBody: body,
        secret: 'topsecret-0123456789',
      }),
    ).toBe(true)
  })

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['no prefix', good.slice(7)],
    ['the SHA-1 prefix', `sha1=${'a'.repeat(40)}`],
    ['an uppercase digest', `sha256=${good.slice(7).toUpperCase()}`],
    ['a short digest', good.slice(0, -2)],
    ['a long digest', `${good}ab`],
    ['trailing space', `${good} `],
    ['a non-hex digest', `sha256=${'z'.repeat(64)}`],
    ['the wrong digest', `sha256=${'0'.repeat(64)}`],
  ])('refuses %s', (_label, header) => {
    expect(verifyGithubSignature({ header, rawBody: payload, secret })).toBe(
      false,
    )
  })

  it('refuses a body that was changed by one byte, or a different secret', () => {
    expect(
      verifyGithubSignature({
        header: good,
        rawBody: Buffer.from('Hello, World?'),
        secret,
      }),
    ).toBe(false)
    expect(
      verifyGithubSignature({
        header: good,
        rawBody: payload,
        secret: `${secret}x`,
      }),
    ).toBe(false)
  })

  it('checks the shape without needing the secret', () => {
    expect(isWellFormedGithubSignature(good)).toBe(true)
    expect(isWellFormedGithubSignature(null)).toBe(false)
    expect(isWellFormedGithubSignature('sha256=abc')).toBe(false)
  })
})

function jwt(
  claims: Record<string, unknown>,
  key = CURRENT,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
) {
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const signed = `${enc(header)}.${enc(claims)}`
  const sig = createHmac('sha256', key).update(signed).digest('base64url')
  return `${signed}.${sig}`
}
const bodyHash = (body: Buffer) =>
  createHash('sha256').update(body).digest('base64url')
const claims = (over: Record<string, unknown> = {}) => ({
  iss: 'Upstash',
  sub: URL_,
  exp: SEC + 300,
  nbf: SEC - 1,
  iat: SEC - 1,
  jti: 'jwt_1',
  body: bodyHash(BODY),
  ...over,
})
const check = (signature: string | null, over: Record<string, unknown> = {}) =>
  verifyQstashSignature({
    signature,
    rawBody: BODY,
    url: URL_,
    keys: [CURRENT, NEXT],
    nowMs: NOW,
    ...over,
  })

describe('QStash signature', () => {
  it('accepts a token signed with the current key', () => {
    expect(check(jwt(claims()))).toBe(true)
  })

  it('accepts a token signed with the next key (during rotation)', () => {
    expect(check(jwt(claims(), NEXT))).toBe(true)
  })

  it('refuses a key that is neither', () => {
    expect(check(jwt(claims(), 'some-other-key-0123456789'))).toBe(false)
  })

  it('accepts the body claim with or without padding, and in either base64 alphabet', () => {
    const hash = createHash('sha256').update(BODY).digest('base64')
    for (const body of [
      hash,
      hash.replace(/=+$/, ''),
      hash.replace(/\+/g, '-').replace(/\//g, '_'),
    ]) {
      expect(check(jwt(claims({ body })))).toBe(true)
    }
  })

  it('refuses a token for another URL', () => {
    expect(
      check(jwt(claims({ sub: 'https://shipnote.test/api/queue/other' }))),
    ).toBe(false)
    expect(check(jwt(claims({ sub: `${URL_}/` })))).toBe(false)
    expect(
      check(jwt(claims()), { url: 'https://evil.test/api/queue/draft' }),
    ).toBe(false)
  })

  it('refuses a body that was tampered with', () => {
    expect(
      check(jwt(claims()), {
        rawBody: Buffer.from('{"projectId":"p","userId":"EVIL"}'),
      }),
    ).toBe(false)
    expect(
      check(jwt(claims()), {
        rawBody: Buffer.concat([BODY, Buffer.from(' ')]),
      }),
    ).toBe(false)
    expect(check(jwt(claims({ body: undefined })))).toBe(false)
    expect(check(jwt(claims({ body: 42 })))).toBe(false)
  })

  it('refuses an expired token, and accepts it until the last second', () => {
    expect(check(jwt(claims({ exp: SEC })))).toBe(false)
    expect(check(jwt(claims({ exp: SEC - 100 })))).toBe(false)
    expect(check(jwt(claims({ exp: SEC + 1 })))).toBe(true)
    expect(check(jwt(claims({ exp: undefined })))).toBe(false)
    expect(check(jwt(claims({ exp: String(SEC + 300) })))).toBe(false)
  })

  it('refuses a token not valid yet, with a few seconds of clock skew allowed', () => {
    expect(check(jwt(claims({ nbf: SEC + 60 })))).toBe(false)
    expect(check(jwt(claims({ nbf: SEC + 3 })))).toBe(true)
    expect(check(jwt(claims({ nbf: undefined })))).toBe(false)
  })

  it('refuses another issuer', () => {
    expect(check(jwt(claims({ iss: 'Evil' })))).toBe(false)
    expect(check(jwt(claims({ iss: undefined })))).toBe(false)
  })

  it.each([
    ['none', { alg: 'none' }],
    ['HS512', { alg: 'HS512' }],
    ['RS256', { alg: 'RS256' }],
    ['no alg', { typ: 'JWT' }],
    ['a lower case alg', { alg: 'hs256' }],
  ])(
    'refuses the algorithm %s, even if the signature fits',
    (_label, header) => {
      expect(check(jwt(claims(), CURRENT, header))).toBe(false)
    },
  )

  it('refuses an unsigned token (alg none, empty signature)', () => {
    const enc = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url')
    expect(check(`${enc({ alg: 'none' })}.${enc(claims())}.`)).toBe(false)
  })

  it('refuses claims changed after signing', () => {
    const [h, , s] = jwt(claims()).split('.')
    const forged = Buffer.from(
      JSON.stringify(claims({ sub: 'https://evil.test/x' })),
    ).toString('base64url')
    expect(check(`${h}.${forged}.${s}`)).toBe(false)
  })

  it.each([
    null,
    '',
    'x',
    'a.b',
    'a.b.c.d',
    '..',
    'a b.c.d',
    `${'a'.repeat(5000)}.b.c`,
    'Zm9v.Zm9v.Zm9v',
  ])('refuses junk %j', (signature) => {
    expect(check(signature)).toBe(false)
  })

  it('refuses everything when there are no keys', () => {
    expect(check(jwt(claims()), { keys: [] })).toBe(false)
  })

  it('does not read the claims of an unsigned token', () => {
    // A token whose claims are not even JSON, signed with a wrong key.
    const bad = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('not json').toString('base64url')}.${'A'.repeat(43)}`
    expect(check(bad)).toBe(false)
  })
})
