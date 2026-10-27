import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const autoDraftsOn = vi.fn()
const autoDraftsConfig = vi.fn()
const rateLimit = vi.fn()
const resolveAutoDraftTarget = vi.fn()
const recordWebhookDelivery = vi.fn()
const finishWebhookDelivery = vi.fn()
const createAutoDraftJob = vi.fn()
const finishAutoDraftJob = vi.fn()
const publishAutoDraftJob = vi.fn()
const verifySpy = vi.fn()

class QstashError extends Error {
  kind = 'unavailable'
}

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(),
}))
vi.mock('@/server/auto-drafts', () => ({ autoDraftsOn, autoDraftsConfig }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/qstash', () => ({ publishAutoDraftJob, QstashError }))
vi.mock('@/server/supabase-admin', () => ({
  resolveAutoDraftTarget,
  recordWebhookDelivery,
  finishWebhookDelivery,
  createAutoDraftJob,
  finishAutoDraftJob,
}))
vi.mock('@/server/webhook-verify', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/webhook-verify')>()
  verifySpy.mockImplementation(real.verifyGithubSignature)
  return { ...real, verifyGithubSignature: verifySpy }
})

const { POST } = await import('./route')

const SECRET = 'github-webhook-secret-0123456789'
const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const DELIVERY = '33333333-aaaa-4bbb-8ccc-444444444444'
const SHA = (n: number) => `${n.toString(16).padStart(2, '0')}${'a'.repeat(38)}`

const commit = (n: number, message = `Add thing ${String(n)} [post]`) => ({
  id: SHA(n),
  message,
  author: { name: 'someone', email: 'someone@example.test' },
})

const push = (over: Record<string, unknown> = {}) => ({
  ref: 'refs/heads/main',
  deleted: false,
  repository: {
    full_name: 'octo/hello',
    default_branch: 'main',
    owner: { id: 999, login: 'someone-else' },
  },
  installation: { id: 101 },
  sender: { id: 12345 },
  pusher: { name: 'someone' },
  commits: [commit(1)],
  ...over,
})

const sign = (body: string | Buffer, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

function call(
  body: unknown,
  headers: Record<string, string | null> = {},
  over: { raw?: string; signWith?: string } = {},
) {
  const raw = over.raw ?? JSON.stringify(body)
  const all: Record<string, string | null> = {
    'content-type': 'application/json',
    'x-github-event': 'push',
    'x-github-delivery': DELIVERY,
    'x-hub-signature-256': sign(raw, over.signWith),
    ...headers,
  }
  const init: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (value !== null) init[key] = value
  }
  return POST(
    new NextRequest('https://shipnote.test/api/webhooks/github', {
      method: 'POST',
      headers: init,
      body: raw,
    }),
  )
}

const noWrites = () => {
  expect(resolveAutoDraftTarget).not.toHaveBeenCalled()
  expect(recordWebhookDelivery).not.toHaveBeenCalled()
  expect(createAutoDraftJob).not.toHaveBeenCalled()
  expect(finishAutoDraftJob).not.toHaveBeenCalled()
  expect(finishWebhookDelivery).not.toHaveBeenCalled()
  expect(publishAutoDraftJob).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  autoDraftsOn.mockReturnValue(true)
  autoDraftsConfig.mockReturnValue({
    webhookSecret: SECRET,
    qstashToken: 't',
    signingKeys: ['a', 'b'],
    qstashUrl: 'https://qstash.upstash.io',
  })
  rateLimit.mockResolvedValue(true)
  resolveAutoDraftTarget.mockResolvedValue({ userId: USER, projectId: PROJECT })
  recordWebhookDelivery.mockResolvedValue('new')
  finishWebhookDelivery.mockResolvedValue(true)
  createAutoDraftJob.mockImplementation((job: { commitSha: string }) =>
    Promise.resolve({ ok: true, id: `job-${job.commitSha.slice(0, 2)}` }),
  )
  finishAutoDraftJob.mockResolvedValue(true)
  publishAutoDraftJob.mockResolvedValue(undefined)
})

describe('the switch', () => {
  it('is a 404 while automatic drafts are off, and does nothing', async () => {
    autoDraftsOn.mockReturnValue(false)
    expect((await call(push())).status).toBe(404)
    expect(rateLimit).not.toHaveBeenCalled()
    noWrites()
  })

  it('is a 404 when the settings are not there', async () => {
    autoDraftsConfig.mockReturnValue(null)
    expect((await call(push())).status).toBe(404)
    noWrites()
  })
})

describe('the signature comes first', () => {
  it.each([
    ['no signature header', { 'x-hub-signature-256': null }],
    ['an empty header', { 'x-hub-signature-256': '' }],
    [
      'the old SHA-1 header only',
      {
        'x-hub-signature-256': null,
        'x-hub-signature': `sha1=${'a'.repeat(40)}`,
      },
    ],
    ['no sha256= prefix', { 'x-hub-signature-256': 'a'.repeat(64) }],
    ['a short digest', { 'x-hub-signature-256': `sha256=${'a'.repeat(63)}` }],
    [
      'an uppercase digest',
      { 'x-hub-signature-256': `sha256=${'A'.repeat(64)}` },
    ],
    ['a wrong digest', { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` }],
  ])('%s is a 401 with no writes', async (_label, headers) => {
    const response = await call(push(), headers)
    expect(response.status).toBe(401)
    expect(rateLimit).not.toHaveBeenCalled()
    noWrites()
  })

  it('a signature made with another secret is a 401', async () => {
    expect(
      (await call(push(), {}, { signWith: 'another-secret-0123456789' }))
        .status,
    ).toBe(401)
    noWrites()
  })

  it('a signature for a different body is a 401, even if one byte differs', async () => {
    const good = JSON.stringify(push())
    const response = await call(
      push(),
      { 'x-hub-signature-256': sign(good) },
      { raw: `${good} ` },
    )
    expect(response.status).toBe(401)
    noWrites()
  })

  it('a body that is not JSON but is badly signed is a 401, not a 400: it is not parsed', async () => {
    const response = await call(
      null,
      { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
      { raw: '{not json' },
    )
    expect(response.status).toBe(401)
    noWrites()
  })

  it('checks the HMAC over the raw bytes with the configured secret', async () => {
    const raw = JSON.stringify(push())
    await call(null, {}, { raw })
    expect(verifySpy).toHaveBeenCalledOnce()
    const input = verifySpy.mock.calls[0]?.[0] as {
      rawBody: Buffer
      secret: string
    }
    expect(input.rawBody.toString('utf8')).toBe(raw)
    expect(input.secret).toBe(SECRET)
  })

  it('answers with a short generic body and no detail', async () => {
    const response = await call(push(), { 'x-hub-signature-256': null })
    expect(await response.json()).toEqual({})
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('size', () => {
  it('a declared length over the cap is a 413 before anything is read', async () => {
    const response = await call(push(), {
      'content-length': String(1024 * 1024 + 1),
    })
    expect(response.status).toBe(413)
    expect(verifySpy).not.toHaveBeenCalled()
    noWrites()
  })

  it('a signed body over the cap is a 413 and is not parsed', async () => {
    const big = JSON.stringify(push({ padding: 'x'.repeat(1024 * 1024) }))
    const response = await call(null, {}, { raw: big })
    expect(response.status).toBe(413)
    noWrites()
  })

  it('an unsigned body over the cap is a 413 too', async () => {
    const big = JSON.stringify(push({ padding: 'x'.repeat(1024 * 1024) }))
    const response = await call(
      null,
      { 'x-hub-signature-256': null },
      { raw: big },
    )
    expect([401, 413]).toContain(response.status)
    noWrites()
  })

  it('a body just under the cap is read', async () => {
    const raw = JSON.stringify(
      push({ padding: 'x'.repeat(1024 * 1024 - 2000) }),
    )
    expect((await call(null, {}, { raw })).status).toBe(202)
  })
})

describe('events', () => {
  it.each(['ping', 'issues', 'pull_request', 'installation', 'create', ''])(
    'a signed %j event is acknowledged and ignored',
    async (event) => {
      const response = await call(push(), { 'x-github-event': event })
      expect(response.status).toBe(200)
      noWrites()
    },
  )

  it('a signed push without a delivery id, or with a bad one, is a 400', async () => {
    for (const id of [
      null,
      '',
      'short',
      'has space in it',
      'a'.repeat(65),
      "x'; drop",
    ]) {
      expect((await call(push(), { 'x-github-delivery': id })).status).toBe(400)
    }
    noWrites()
  })

  it('a signed push whose body is not JSON, or not a push, is a 400', async () => {
    expect((await call(null, {}, { raw: '{not json' })).status).toBe(400)
    expect((await call({ hello: 'world' })).status).toBe(400)
    expect((await call(push({ installation: { id: 'x' } }))).status).toBe(400)
    expect((await call(push({ commits: 'nope' }))).status).toBe(400)
    noWrites()
  })
})

describe('a valid push', () => {
  it('creates one job for the [post] commit and publishes it, with identifiers only', async () => {
    const response = await call(push())
    expect(response.status).toBe(202)
    expect(createAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      projectId: PROJECT,
      commitSha: SHA(1),
      deliveryId: DELIVERY,
    })
    expect(publishAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      projectId: PROJECT,
      commitSha: SHA(1),
      deliveryId: DELIVERY,
    })
    expect(finishWebhookDelivery).toHaveBeenCalledExactlyOnceWith(DELIVERY)
  })

  it('resolves the user from the installation id and repository name, never from the payload', async () => {
    await call(
      push({
        sender: { id: 1, login: 'evil' },
        repository: {
          full_name: 'octo/hello',
          default_branch: 'main',
          owner: { id: 7, login: 'evil' },
        },
      }),
    )
    expect(resolveAutoDraftTarget).toHaveBeenCalledExactlyOnceWith(
      101,
      'octo/hello',
    )
    expect(JSON.stringify(createAutoDraftJob.mock.calls)).not.toContain('evil')
    expect(createAutoDraftJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
    )
  })

  it('the message never carries commit text, names or emails', async () => {
    await call(push({ commits: [commit(1, 'Add PRIVATE-TEXT export [post]')] }))
    const sent = JSON.stringify([
      createAutoDraftJob.mock.calls,
      publishAutoDraftJob.mock.calls,
    ])
    for (const secret of ['PRIVATE-TEXT', 'someone@example.test', 'someone']) {
      expect(sent).not.toContain(secret)
    }
  })

  it('finds [post] in any case and anywhere in the message', async () => {
    await call(
      push({
        commits: [
          commit(1, 'x [POST]'),
          commit(2, 'title\n\nbody [Post] end'),
          commit(3, 'no tag here'),
          commit(4, '[posts] is not it'),
        ],
      }),
    )
    const shas = createAutoDraftJob.mock.calls.map(
      (c) => (c[0] as { commitSha: string }).commitSha,
    )
    expect(shas).toEqual([SHA(1), SHA(2)])
  })

  it('takes at most 5 commits per push, the newest', async () => {
    const commits = Array.from({ length: 8 }, (_, i) => commit(i + 1))
    await call(push({ commits }))
    const shas = createAutoDraftJob.mock.calls.map(
      (c) => (c[0] as { commitSha: string }).commitSha,
    )
    expect(shas).toEqual([SHA(4), SHA(5), SHA(6), SHA(7), SHA(8)])
    expect(publishAutoDraftJob).toHaveBeenCalledTimes(5)
  })

  it('skips merge commits by their message, and a repeated commit id', async () => {
    await call(
      push({
        commits: [
          commit(1, 'Merge pull request #12 from a/b [post]'),
          commit(2, "Merge branch 'x' into main [post]"),
          commit(3, 'Merge sort implementation [post]'),
          commit(3, 'Merge sort implementation [post]'),
        ],
      }),
    )
    const shas = createAutoDraftJob.mock.calls.map(
      (c) => (c[0] as { commitSha: string }).commitSha,
    )
    expect(shas).toEqual([SHA(3)])
  })

  it('ignores a commit id that is not a full sha', async () => {
    await call(
      push({
        commits: [
          { id: 'abc1234', message: '[post] x' },
          { id: 'A'.repeat(40), message: '[post] x' },
        ],
      }),
    )
    expect(createAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a push with no [post] commit writes nothing at all', async () => {
    const response = await call(push({ commits: [commit(1, 'chore: deps')] }))
    expect(response.status).toBe(200)
    noWrites()
  })
})

describe('what is ignored', () => {
  it('a repository nobody linked, a switch that is off, or a deleted account', async () => {
    resolveAutoDraftTarget.mockResolvedValue(null)
    const response = await call(push())
    expect(response.status).toBe(200)
    expect(recordWebhookDelivery).not.toHaveBeenCalled()
    expect(createAutoDraftJob).not.toHaveBeenCalled()
    expect(publishAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a push to another branch, or one that deletes a branch', async () => {
    expect((await call(push({ ref: 'refs/heads/feature' }))).status).toBe(200)
    expect((await call(push({ ref: 'refs/tags/v1' }))).status).toBe(200)
    expect((await call(push({ deleted: true }))).status).toBe(200)
    expect(
      (await call(push({ repository: { full_name: 'octo/hello' } }))).status,
    ).toBe(200)
    expect(resolveAutoDraftTarget).not.toHaveBeenCalled()
    noWrites()
  })
})

describe('deliveries and duplicates', () => {
  it('the same delivery handled again creates and publishes nothing', async () => {
    recordWebhookDelivery.mockResolvedValue('duplicate')
    const response = await call(push())
    expect(response.status).toBe(200)
    expect(createAutoDraftJob).not.toHaveBeenCalled()
    expect(publishAutoDraftJob).not.toHaveBeenCalled()
    expect(finishWebhookDelivery).not.toHaveBeenCalled()
  })

  it('a delivery that was started but not finished is worked again', async () => {
    recordWebhookDelivery.mockResolvedValue('retry')
    expect((await call(push())).status).toBe(202)
    expect(createAutoDraftJob).toHaveBeenCalledOnce()
  })

  it('a commit that already has a job is not published again', async () => {
    createAutoDraftJob.mockResolvedValue({ ok: true, id: null })
    const response = await call(push())
    expect(response.status).toBe(202)
    expect(publishAutoDraftJob).not.toHaveBeenCalled()
    expect(finishWebhookDelivery).toHaveBeenCalledOnce()
  })

  it('a database failure recording the delivery means no work and a 503', async () => {
    recordWebhookDelivery.mockResolvedValue(null)
    expect((await call(push())).status).toBe(503)
    expect(createAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a database failure resolving the project is a 503 with no writes', async () => {
    resolveAutoDraftTarget.mockResolvedValue('failed')
    expect((await call(push())).status).toBe(503)
    expect(recordWebhookDelivery).not.toHaveBeenCalled()
  })

  it('a failure creating a job is a 503 and the delivery is left open for a redelivery', async () => {
    createAutoDraftJob.mockResolvedValue({ ok: false })
    expect((await call(push())).status).toBe(503)
    expect(finishWebhookDelivery).not.toHaveBeenCalled()
    expect(publishAutoDraftJob).not.toHaveBeenCalled()
  })

  it('a queue that cannot be reached ends the job as failed, says 503, and leaves the delivery open', async () => {
    publishAutoDraftJob.mockRejectedValue(new QstashError())
    expect((await call(push())).status).toBe(503)
    expect(finishAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      jobId: `job-${SHA(1).slice(0, 2)}`,
      userId: USER,
      status: 'failed',
      reason: 'queue_unavailable',
      draftId: null,
    })
    expect(finishWebhookDelivery).not.toHaveBeenCalled()
  })

  it('an unexpected error is not swallowed', async () => {
    publishAutoDraftJob.mockRejectedValue(new Error('boom'))
    await expect(call(push())).rejects.toThrow('boom')
  })
})

describe('the brake', () => {
  it('is per installation, applied only after the signature', async () => {
    await call(push())
    expect(rateLimit).toHaveBeenCalledExactlyOnceWith('autoDraftWebhook', '101')
  })

  it('a limited installation gets 429 and no writes', async () => {
    rateLimit.mockResolvedValue(false)
    expect((await call(push())).status).toBe(429)
    noWrites()
  })
})

describe('logs', () => {
  it('never contain a body, commit text, a signature or a secret', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    const raw = JSON.stringify(
      push({ commits: [commit(1, 'Add PRIVATE-TEXT [post]')] }),
    )
    await call(null, {}, { raw })
    await call(
      null,
      { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
      { raw },
    )
    publishAutoDraftJob.mockRejectedValue(new QstashError())
    await call(null, {}, { raw })
    await call(null, {}, { raw: '{not json' })
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls))
    for (const secret of [
      'PRIVATE-TEXT',
      SECRET,
      sign(raw),
      'someone@example.test',
    ]) {
      expect(logged).not.toContain(secret)
    }
  })
})
