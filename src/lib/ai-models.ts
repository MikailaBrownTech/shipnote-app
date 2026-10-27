// The models drafts may use, what they cost, and how a request to them is
// shaped. One small file, so a price change is one edit.
//
// Prices and limits were read from Anthropic's documentation on
// PRICES_READ_ON (platform.claude.com/docs/en/about-claude/pricing and the
// model pages). They are NOT fetched at run time: check them again before
// trusting the cost figures. Cost is always computed from the token counts the
// API reports in `usage`.
//
// This file has no imports, so the draft:compare script can load it directly.

export const PRICES_READ_ON = '2026-10-27'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'

// A few hundred words of output is 250 to 350 tokens; this leaves room.
export const MAX_OUTPUT_TOKENS = 450

// Documented minimum prompt length for prompt caching on both models. Drafts
// do not use caching (see the README): the fixed prompt is short, requests
// from one user are minutes apart, and a cache write costs 1.25x the input
// price, so it would raise the cost more often than it lowers it.
export const CACHE_MIN_TOKENS = 512

export type ThinkingSetting =
  // Sonnet 5.5 rejects "disabled"; "between_tools" is its lowest setting and
  // means no up-front thinking, so no thinking tokens are billed.
  | { type: 'between_tools' }
  // Haiku 5.5 accepts "disabled".
  | { type: 'disabled' }

export type ModelConfig = {
  id: string
  // Dollars per million tokens, which is the same as micro-dollars per token.
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  // Haiku 5.5 charges more for a prompt over 100,000 tokens. Drafts are nowhere
  // near that, but the cost function follows the documented rule anyway.
  longContext?: {
    aboveInputTokens: number
    inputUsdPerMTok: number
    outputUsdPerMTok: number
  }
  // Cache reads cost this multiple of the input price (0.05 on Sonnet 5.5,
  // 0.1 on Haiku 5.5). Cache writes (5 minute) cost 1.25 times.
  cacheReadMultiplier: number
  thinking: ThinkingSetting
}

export const MODELS: Readonly<Record<string, ModelConfig>> = {
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheReadMultiplier: 0.05,
    thinking: { type: 'between_tools' },
  },
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    longContext: {
      aboveInputTokens: 100_000,
      inputUsdPerMTok: 0.5,
      outputUsdPerMTok: 2.5,
    },
    cacheReadMultiplier: 0.1,
    thinking: { type: 'disabled' },
  },
}

export function modelConfig(id: string): ModelConfig | null {
  return Object.hasOwn(MODELS, id) ? (MODELS[id] ?? null) : null
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// Cost in micro-dollars (a millionth of a dollar), rounded up so the ledger
// never understates what was spent.
export function costMicrousd(model: ModelConfig, usage: Usage): number {
  const written = usage.cache_creation_input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  // A prompt's length counts every input token, cached or not.
  const promptTokens = usage.input_tokens + written + read
  const long =
    model.longContext && promptTokens > model.longContext.aboveInputTokens
      ? model.longContext
      : null
  const input = long?.inputUsdPerMTok ?? model.inputUsdPerMTok
  const output = long?.outputUsdPerMTok ?? model.outputUsdPerMTok

  const total =
    usage.input_tokens * input +
    written * input * 1.25 +
    read * input * model.cacheReadMultiplier +
    usage.output_tokens * output
  // Remove floating point noise before rounding up.
  return Math.ceil(Number(total.toFixed(6)))
}

// A deliberate over-estimate, used to reserve a slot and some of the monthly
// budget before the call: input at about 3 characters a token (the newer
// tokenizer counts more tokens than older ones) and the full output allowance.
export function estimateMicrousd(
  model: ModelConfig,
  inputChars: number,
): number {
  const inputTokens = Math.ceil(inputChars / 3)
  return costMicrousd(model, {
    input_tokens: inputTokens,
    output_tokens: MAX_OUTPUT_TOKENS,
  })
}

// The body of POST /v1/messages. Sampling parameters (temperature and the
// like) are left out on purpose: the docs say to omit them for these models.
export function messagesRequestBody(input: {
  model: ModelConfig
  system: string
  user: string
}) {
  return {
    model: input.model.id,
    max_tokens: MAX_OUTPUT_TOKENS,
    thinking: input.model.thinking,
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
  }
}
