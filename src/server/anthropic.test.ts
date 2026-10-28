import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modelConfig } from '@/lib/ai-models'

const outboundFetch = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./outbound', () => ({ outboundFetch }))

const { AnthropicError, complete } = await import('./anthropic')

const sonnet = modelConfig('claude-sonnet-5-5')
const haiku = modelConfig('claude-haiku-5-5')
if (!sonnet || !haiku) throw new Error('models missing')

const KEY = 'sk-ant-api03-SECRET-KEY-VALUE-1234567890'
const PROMPT = 'PRIVATE PROMPT TEXT do-not-log'

const ok = (over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'A draft post.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 812, output_tokens: 231 },
      ...over,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
const status = (code: number, body: unknown = { error: { message: PROMPT } }) =>
  new Response(JSON.stringify(body), { status: code })

const call = (model = sonnet) =>
  complete({ apiKey: KEY, model, system: 'SYSTEM', user: PROMPT })

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error instanceof AnthropicError
      ? { kind: error.kind, status: error.status, text: String(error) }
      : { kind: 'not-an-anthropic-error', status: null, text: String(error) }
  }
  return null
}

describe('complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    outboundFetch.mockImplementation(() => Promise.resolve(ok()))
  })

  it('posts to the Messages endpoint with the key and the documented version header', async () => {
    await call()
    const [url, init] = outboundFetch.mock.calls[0] as [
      string,
      RequestInit & { timeoutMs?: number },
    ]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    expect(init.timeoutMs).toBe(40_000)
  })

  it('sends one user message, capped output, no sampling parameters, and thinking off', async () => {
    await call()
    const body = JSON.parse(
      (outboundFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 450,
      thinking: { type: 'between_tools' },
      system: 'SYSTEM',
      messages: [{ role: 'user', content: PROMPT }],
    })
  })

  it('turns thinking off the way Haiku accepts', async () => {
    await call(haiku)
    const body = JSON.parse(
      (outboundFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { thinking: unknown; model: string }
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.model).toBe('claude-haiku-5-5')
  })

  it('returns the text and the usage the API reported', async () => {
    expect(await call()).toEqual({
      text: 'A draft post.',
      usage: {
        input_tokens: 812,
        output_tokens: 231,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    })
  })

  it('reads cache usage when the API reports it', async () => {
    outboundFetch.mockImplementation(() =>
      Promise.resolve(
        ok({
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 40,
          },
        }),
      ),
    )
    expect((await call()).usage).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 40,
    })
  })

  it('joins text blocks and ignores other block types', async () => {
    outboundFetch.mockImplementation(() =>
      Promise.resolve(
        ok({
          content: [
            { type: 'thinking', thinking: 'hidden' },
            { type: 'text', text: 'One. ' },
            { type: 'text', text: 'Two.' },
          ],
        }),
      ),
    )
    expect((await call()).text).toBe('One. Two.')
  })

  it('an answer with no text is returned empty (it was billed), for the caller to reject', async () => {
    outboundFetch.mockImplementation(() => Promise.resolve(ok({ content: [] })))
    expect((await call()).text).toBe('')
  })

  it('reports a cut-off answer through the stop reason', async () => {
    outboundFetch.mockImplementation(() =>
      Promise.resolve(ok({ stop_reason: 'max_tokens' })),
    )
    expect((await call()).stopReason).toBe('max_tokens')
  })
})

describe('failures are plain kinds, never retried', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [429, 'rate_limited'],
    [401, 'auth'],
    [402, 'auth'],
    [403, 'auth'],
    [400, 'bad_request'],
    [413, 'bad_request'],
    [422, 'bad_request'],
    [404, 'bad_request'],
    [500, 'overloaded'],
    [502, 'overloaded'],
    [503, 'overloaded'],
    [504, 'overloaded'],
    [529, 'overloaded'],
  ])('HTTP %s is %s', async (code, kind) => {
    outboundFetch.mockImplementation(() => Promise.resolve(status(code)))
    const result = await failure(call())
    expect(result).toMatchObject({ kind, status: code })
    // One attempt only: no automatic retry.
    expect(outboundFetch).toHaveBeenCalledOnce()
  })

  it('a timeout is "timeout"', async () => {
    const error = new Error('t')
    error.name = 'TimeoutError'
    outboundFetch.mockRejectedValue(error)
    expect(await failure(call())).toMatchObject({ kind: 'timeout' })
    expect(outboundFetch).toHaveBeenCalledOnce()
  })

  it('an abort is "timeout"', async () => {
    const error = new Error('a')
    error.name = 'AbortError'
    outboundFetch.mockRejectedValue(error)
    expect(await failure(call())).toMatchObject({ kind: 'timeout' })
  })

  it('any other failure (network, refused host, redirect) is "network"', async () => {
    outboundFetch.mockRejectedValue(new Error('ECONNRESET'))
    expect(await failure(call())).toMatchObject({ kind: 'network' })
  })

  it.each([
    ['not JSON', new Response('<html>', { status: 200 })],
    [
      'no usage',
      new Response(JSON.stringify({ content: [] }), { status: 200 }),
    ],
    [
      'a negative token count',
      ok({ usage: { input_tokens: -1, output_tokens: 0 } }),
    ],
    [
      'fractional tokens',
      ok({ usage: { input_tokens: 1.5, output_tokens: 0 } }),
    ],
    ['content that is not a list', ok({ content: 'text' })],
  ])('%s is an invalid response', async (_label, response) => {
    outboundFetch.mockImplementation(() => Promise.resolve(response))
    expect(await failure(call())).toMatchObject({ kind: 'invalid_response' })
  })

  it('never puts the key, the prompt or the response body in an error or a log', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    const texts: string[] = []
    for (const code of [400, 401, 429, 500]) {
      outboundFetch.mockImplementation(() =>
        Promise.resolve(
          status(code, { error: { message: `${PROMPT} ${KEY}` } }),
        ),
      )
      const result = await failure(call())
      texts.push(result?.text ?? '')
    }
    outboundFetch.mockRejectedValue(new Error(`boom ${KEY} ${PROMPT}`))
    texts.push((await failure(call()))?.text ?? '')
    outboundFetch.mockImplementation(() => Promise.resolve(ok()))
    await call()

    const everything = JSON.stringify([
      texts,
      spies.map((spy) => spy.mock.calls),
    ])
    expect(everything).not.toContain(KEY)
    expect(everything).not.toContain('do-not-log')
    expect(everything).not.toContain('SECRET-KEY')
  })
})
