import 'server-only'
import { z } from 'zod'
import {
  messagesRequestBody,
  type ModelConfig,
  type Usage,
} from '@/lib/ai-models'
import { outboundFetch } from './outbound'

// The only module that talks to Anthropic. It calls the HTTPS API directly
// through outboundFetch instead of using the official SDK, because:
//   - every request must pass the outbound host allowlist, and the SDK would
//     need a custom fetch to do that;
//   - the SDK retries failed requests by default, and a draft must never be
//     retried automatically (a retry would spend more);
//   - one POST is all that is needed.
//
// Nothing here logs or returns a prompt, a draft, a key or a response body.
// Errors carry only a fixed kind and the HTTP status.

export type AnthropicFailure =
  | 'rate_limited' // 429
  | 'overloaded' // 500, 502, 503, 504, 529
  | 'timeout'
  | 'network'
  | 'auth' // 401, 402, 403: the key, billing or permissions
  | 'bad_request' // 400, 413, 422, anything else unexpected
  | 'invalid_response' // not the shape the API documents

export class AnthropicError extends Error {
  readonly kind: AnthropicFailure
  readonly status: number | null
  constructor(kind: AnthropicFailure, status: number | null = null) {
    super(`Anthropic request failed: ${kind}`)
    this.name = 'AnthropicError'
    this.kind = kind
    this.status = status
  }
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
// The API version header the docs use in their examples.
const API_VERSION = '2023-06-01'

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
    cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  }),
})

export type Completion = {
  text: string
  usage: Usage
  stopReason: string | null
}

function failureFor(status: number): AnthropicFailure {
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 402 || status === 403) return 'auth'
  if (status >= 500) return 'overloaded'
  return 'bad_request'
}

// One call, no retry. The caller decides what a failure means for the ledger.
export async function complete(input: {
  apiKey: string
  model: ModelConfig
  system: string
  user: string
  timeoutMs?: number
}): Promise<Completion> {
  let response: Response
  try {
    response = await outboundFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': input.apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        messagesRequestBody({
          model: input.model,
          system: input.system,
          user: input.user,
        }),
      ),
      timeoutMs: input.timeoutMs ?? 30_000,
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    throw new AnthropicError(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
    )
  }

  if (!response.ok) {
    // The body is never read: it could echo the request.
    throw new AnthropicError(failureFor(response.status), response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AnthropicError('invalid_response', response.status)
  }
  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) {
    throw new AnthropicError('invalid_response', response.status)
  }

  const { content, usage, stop_reason } = parsed.data
  return {
    text: content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join(''),
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
    stopReason: stop_reason ?? null,
  }
}
