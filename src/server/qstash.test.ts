import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboundFetch = vi.fn()
const getAutoDraftsEnv = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))
vi.mock('./env', () => ({ getAutoDraftsEnv }))
vi.mock('./outbound', () => ({ outboundFetch }))

const { publishAutoDraftJob, queueUrl, QstashError } = await import('./qstash')

const TOKEN = 'qstash-token-SECRET-0123456789'
const job = {
  projectId: '11111111-2222-4333-8444-555555555555',
  userId: '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01',
  commitSha: 'a'.repeat(40),
  deliveryId: '33333333-aaaa-4bbb-8ccc-444444444444',
}

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof QstashError ? error.kind : 'not-a-qstash-error'
  }
  return 'resolved'
}

beforeEach(() => {
  vi.clearAllMocks()
  getAutoDraftsEnv.mockReturnValue({
    qstashToken: TOKEN,
    qstashUrl: 'https://qstash.upstash.io',
    signingKeys: ['a', 'b'],
    webhookSecret: 'x',
  })
  outboundFetch.mockResolvedValue(
    new Response('{"messageId":"m"}', { status: 200 }),
  )
})

describe('queueUrl', () => {
  it('is built from the configured site URL', () => {
    expect(queueUrl()).toBe('https://shipnote.test/api/queue/draft')
  })
})

describe('publishAutoDraftJob', () => {
  it('posts one message to the publish endpoint for the worker URL', async () => {
    await publishAutoDraftJob(job)
    expect(outboundFetch).toHaveBeenCalledOnce()
    const [url, init] = outboundFetch.mock.calls[0] as [
      string,
      RequestInit & { timeoutMs?: number },
    ]
    expect(url).toBe(
      'https://qstash.upstash.io/v2/publish/https://shipnote.test/api/queue/draft',
    )
    expect(init.method).toBe('POST')
    expect(init.timeoutMs).toBe(5000)
  })

  it('authorises with the token, asks for 3 retries and deduplicates on project and commit', async () => {
    await publishAutoDraftJob(job)
    const init = (outboundFetch.mock.calls[0] as [string, RequestInit])[1]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers['Upstash-Retries']).toBe('3')
    expect(headers['Upstash-Deduplication-Id']).toBe(
      `${job.projectId}_${job.commitSha}`,
    )
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('the body holds the four identifiers and nothing else', async () => {
    await publishAutoDraftJob(job)
    const init = (outboundFetch.mock.calls[0] as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string)).toEqual(job)
    expect(
      Object.keys(JSON.parse(init.body as string) as object).sort(),
    ).toEqual(['commitSha', 'deliveryId', 'projectId', 'userId'])
  })

  it('uses the regional address from the settings', async () => {
    getAutoDraftsEnv.mockReturnValue({
      qstashToken: TOKEN,
      qstashUrl: 'https://qstash-us-east-1.upstash.io',
    })
    await publishAutoDraftJob(job)
    expect((outboundFetch.mock.calls[0] as [string])[0]).toMatch(
      /^https:\/\/qstash-us-east-1\.upstash\.io\/v2\/publish\//,
    )
  })

  it('does nothing while automatic drafts are off', async () => {
    getAutoDraftsEnv.mockReturnValue(null)
    expect(await kindOf(publishAutoDraftJob(job))).toBe('disabled')
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it.each([
    [200, 'resolved'],
    [202, 'resolved'],
    [400, 'rejected'],
    [401, 'auth'],
    [403, 'auth'],
    [412, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('a %i answer is %s', async (status, kind) => {
    outboundFetch.mockResolvedValue(new Response('{"error":"x"}', { status }))
    expect(await kindOf(publishAutoDraftJob(job))).toBe(kind)
  })

  it('keeps the status and the short error text for the log, without the token', async () => {
    outboundFetch.mockResolvedValue(
      new Response(`{"error":"invalid destination url ${TOKEN}"}`, {
        status: 400,
      }),
    )
    const error: unknown = await publishAutoDraftJob(job).catch(
      (e: unknown) => e,
    )
    expect(error).toMatchObject({
      kind: 'rejected',
      status: 400,
      detail: 'invalid destination url [removed]',
    })
  })

  it('a network failure is unavailable and nothing is retried', async () => {
    outboundFetch.mockRejectedValue(new Error('network'))
    expect(await kindOf(publishAutoDraftJob(job))).toBe('unavailable')
    expect(outboundFetch).toHaveBeenCalledOnce()
  })

  it('the token and the body are in no error and no log', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    outboundFetch.mockResolvedValue(
      new Response(`{"error":"${TOKEN}"}`, { status: 401 }),
    )
    let text = ''
    try {
      await publishAutoDraftJob(job)
    } catch (error) {
      text = String(error)
    }
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(job.commitSha)
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(TOKEN)
  })
})
