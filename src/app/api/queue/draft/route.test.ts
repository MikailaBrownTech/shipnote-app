import { createHash, createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const autoDraftsOn = vi.fn()
const autoDraftsConfig = vi.fn()
const runAutoDraftJob = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))
vi.mock('@/server/auto-drafts', () => ({ autoDraftsOn, autoDraftsConfig }))
vi.mock('@/server/auto-draft-worker', () => ({ runAutoDraftJob }))
vi.mock('@/server/qstash', () => ({
  queueUrl: () => 'https://shipnote.test/api/queue/draft',
}))

const { POST } = await import('./route')

const URL_ = 'https://shipnote.test/api/queue/draft'
const CURRENT = 'current-signing-key-0123456789'
const NEXT = 'next-signing-key-0123456789'
const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const SHA = 'a'.repeat(40)
const DELIVERY = '33333333-aaaa-4bbb-8ccc-444444444444'
const JOB = {
  projectId: PROJECT,
  userId: USER,
  commitSha: SHA,
  deliveryId: DELIVERY,
}

function token(
  raw: string,
  over: {
    key?: string
    sub?: string
    exp?: number
    alg?: string
    body?: string
  } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const signed = `${enc({ alg: over.alg ?? 'HS256', typ: 'JWT' })}.${enc({
    iss: 'Upstash',
    sub: over.sub ?? URL_,
    exp: over.exp ?? now + 300,
    nbf: now - 1,
    iat: now - 1,
    jti: 'jwt_x',
    body: over.body ?? createHash('sha256').update(raw).digest('base64url'),
  })}`
  const sig = createHmac('sha256', over.key ?? CURRENT)
    .update(signed)
    .digest('base64url')
  return `${signed}.${sig}`
}

function call(
  body: unknown = JOB,
  opts: {
    raw?: string
    signature?: string | null
    headers?: Record<string, string>
    signWith?: Parameters<typeof token>[1]
  } = {},
) {
  const raw = opts.raw ?? JSON.stringify(body)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
  }
  const signature =
    opts.signature === undefined ? token(raw, opts.signWith) : opts.signature
  if (signature !== null) headers['upstash-signature'] = signature
  return POST(new NextRequest(URL_, { method: 'POST', headers, body: raw }))
}

beforeEach(() => {
  vi.clearAllMocks()
  autoDraftsOn.mockReturnValue(true)
  autoDraftsConfig.mockReturnValue({
    webhookSecret: 'x',
    qstashToken: 't',
    signingKeys: [CURRENT, NEXT],
    qstashUrl: 'https://qstash.upstash.io',
  })
  runAutoDraftJob.mockResolvedValue('done')
})

describe('the switch', () => {
  it('is a 404 while automatic drafts are off, and does nothing', async () => {
    autoDraftsOn.mockReturnValue(false)
    expect((await call()).status).toBe(404)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })
})

describe('the signature comes first', () => {
  it('no signature header is a 401', async () => {
    expect((await call(JOB, { signature: null })).status).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty signature', ''],
    ['junk', 'not-a-jwt'],
    ['two parts', 'a.b'],
    ['a GitHub style signature', `sha256=${'a'.repeat(64)}`],
  ])('%s is a 401', async (_label, signature) => {
    expect((await call(JOB, { signature })).status).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a token signed with an unknown key is a 401', async () => {
    expect(
      (await call(JOB, { signWith: { key: 'some-other-key-0123456789' } }))
        .status,
    ).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a token for another URL is a 401', async () => {
    expect(
      (
        await call(JOB, {
          signWith: { sub: 'https://shipnote.test/api/queue/other' },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await call(JOB, {
          signWith: { sub: 'https://evil.test/api/queue/draft' },
        })
      ).status,
    ).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a tampered body is a 401: the signature covers the body hash', async () => {
    const original = JSON.stringify(JOB)
    const tampered = JSON.stringify({
      ...JOB,
      userId: '99999999-1b2d-4c3e-8f4a-5b6c7d8e9f01',
    })
    const response = await call(null, {
      raw: tampered,
      signature: token(original),
    })
    expect(response.status).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('an extra space in the body is a 401', async () => {
    const original = JSON.stringify(JOB)
    expect(
      (await call(null, { raw: `${original} `, signature: token(original) }))
        .status,
    ).toBe(401)
  })

  it('an expired token is a 401', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    expect((await call(JOB, { signWith: { exp: past } })).status).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('an algorithm other than HS256 is a 401', async () => {
    expect((await call(JOB, { signWith: { alg: 'none' } })).status).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a bad signature on a body that is not JSON is a 401, not a 400: it is not parsed', async () => {
    expect(
      (await call(null, { raw: '{not json', signature: token('{other', {}) }))
        .status,
    ).toBe(401)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })

  it('answers a refusal with no body', async () => {
    const response = await call(JOB, { signature: null })
    expect(await response.text()).toBe('')
  })
})

describe('a valid signature', () => {
  it('works with the current key', async () => {
    expect((await call()).status).toBe(200)
    expect(runAutoDraftJob).toHaveBeenCalledExactlyOnceWith(JOB, 0)
  })

  it('works with the next key too, so a rotation does not drop jobs', async () => {
    expect((await call(JOB, { signWith: { key: NEXT } })).status).toBe(200)
    expect(runAutoDraftJob).toHaveBeenCalledOnce()
  })

  it('accepts the body hash with or without padding', async () => {
    const raw = JSON.stringify(JOB)
    const padded = createHash('sha256').update(raw).digest('base64')
    expect((await call(JOB, { signWith: { body: padded } })).status).toBe(200)
  })

  it('passes how many times the queue has retried', async () => {
    await call(JOB, { headers: { 'upstash-retried': '2' } })
    expect(runAutoDraftJob).toHaveBeenLastCalledWith(JOB, 2)
    await call(JOB, { headers: { 'upstash-retried': 'x' } })
    expect(runAutoDraftJob).toHaveBeenLastCalledWith(JOB, 0)
  })
})

describe('the message', () => {
  it.each([
    ['not JSON', { raw: '{not json' }],
    [
      'an object missing a field',
      { body: { projectId: PROJECT, userId: USER, commitSha: SHA } },
    ],
    ['a short sha', { body: { ...JOB, commitSha: 'abc1234' } }],
    ['an upper case sha', { body: { ...JOB, commitSha: 'A'.repeat(40) } }],
    ['a user id that is not a uuid', { body: { ...JOB, userId: 'someone' } }],
    [
      'a project id that is not a uuid',
      { body: { ...JOB, projectId: '../x' } },
    ],
    ['a bad delivery id', { body: { ...JOB, deliveryId: 'bad id!' } }],
    [
      'an extra field (commit text)',
      { body: { ...JOB, message: 'Add export [post]' } },
    ],
    ['an array', { body: [JOB] }],
    ['null', { body: null }],
  ])(
    '%s, even if signed, is refused as non-retryable and runs nothing',
    async (_label, input) => {
      const raw = 'raw' in input ? input.raw : JSON.stringify(input.body)
      const response = await call(null, { raw })
      expect(response.status).toBe(489)
      expect(response.headers.get('upstash-nonretryable-error')).toBe('true')
      expect(runAutoDraftJob).not.toHaveBeenCalled()
    },
  )

  it('a body over the cap is a 413 and is not read', async () => {
    const response = await call(null, {
      raw: JSON.stringify({ ...JOB, pad: 'x'.repeat(5000) }),
    })
    expect(response.status).toBe(413)
    expect(runAutoDraftJob).not.toHaveBeenCalled()
  })
})

describe('what the worker says', () => {
  it.each([
    ['done', 200, false],
    ['duplicate', 200, false],
    ['skipped', 200, false],
    ['retry', 503, false],
    ['failed', 489, true],
  ])('%s is answered %i', async (outcome, status, stops) => {
    runAutoDraftJob.mockResolvedValue(outcome)
    const response = await call()
    expect(response.status).toBe(status)
    expect(response.headers.get('upstash-nonretryable-error')).toBe(
      stops ? 'true' : null,
    )
  })

  it('only a 489 with the header stops retries: a retry is a plain 503', async () => {
    runAutoDraftJob.mockResolvedValue('retry')
    const response = await call()
    expect(response.headers.has('upstash-nonretryable-error')).toBe(false)
  })
})

describe('logs', () => {
  it('never contain a body, a signature or a key', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const signature = token(JSON.stringify(JOB))
    await call(JOB)
    await call(JOB, { signature: null })
    await call(JOB, { signWith: { key: 'wrong-key-0123456789' } })
    await call(null, { raw: '{bad' })
    const logged = JSON.stringify(spies.map((s) => s.mock.calls))
    for (const secret of [CURRENT, NEXT, signature, SHA, USER]) {
      expect(logged).not.toContain(secret)
    }
  })
})
