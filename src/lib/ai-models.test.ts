import { describe, expect, it } from 'vitest'
import {
  costMicrousd,
  DEFAULT_MODEL,
  estimateMicrousd,
  MAX_OUTPUT_TOKENS,
  messagesRequestBody,
  modelConfig,
  MODELS,
  PRICES_READ_ON,
} from './ai-models'

const sonnet = modelConfig('claude-sonnet-5-5')
const haiku = modelConfig('claude-haiku-5-5')
if (!sonnet || !haiku) throw new Error('models missing')

describe('the model list', () => {
  it('defaults to Sonnet 5.5 and knows only the two chosen models', () => {
    expect(DEFAULT_MODEL).toBe('claude-sonnet-5-5')
    expect(Object.keys(MODELS)).toEqual([
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ])
  })

  it('records when the prices were read', () => {
    expect(PRICES_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each([
    'gpt-4',
    '',
    '__proto__',
    'constructor',
    'claude-opus-5-5',
    'CLAUDE-SONNET-5-5',
  ])('does not know %s', (id) => {
    expect(modelConfig(id)).toBeNull()
  })
})

describe('costMicrousd', () => {
  it('Sonnet 5.5 is $2 in and $10 out per million tokens', () => {
    // 1,000 in x $2/M = $0.002 = 2,000 micro-dollars; 300 out x $10/M = 3,000.
    expect(
      costMicrousd(sonnet, { input_tokens: 1000, output_tokens: 300 }),
    ).toBe(5000)
    expect(
      costMicrousd(sonnet, { input_tokens: 1_000_000, output_tokens: 0 }),
    ).toBe(2_000_000)
    expect(
      costMicrousd(sonnet, { input_tokens: 0, output_tokens: 1_000_000 }),
    ).toBe(10_000_000)
  })

  it('Haiku 5.5 is $0.10 in and $0.50 out per million tokens', () => {
    expect(
      costMicrousd(haiku, { input_tokens: 1000, output_tokens: 300 }),
    ).toBe(250)
    // 100,000 tokens is the largest prompt still at the base price.
    expect(
      costMicrousd(haiku, { input_tokens: 100_000, output_tokens: 0 }),
    ).toBe(10_000)
  })

  it('Haiku costs more for a prompt over 100,000 tokens', () => {
    expect(
      costMicrousd(haiku, { input_tokens: 100_000, output_tokens: 1000 }),
    ).toBe(10_500)
    expect(
      costMicrousd(haiku, { input_tokens: 100_001, output_tokens: 1000 }),
    ).toBe(
      // 100,001 x 0.50 + 1,000 x 2.50, rounded up.
      52_501,
    )
  })

  it('rounds up, never down', () => {
    expect(costMicrousd(haiku, { input_tokens: 1, output_tokens: 0 })).toBe(1)
    expect(costMicrousd(haiku, { input_tokens: 0, output_tokens: 1 })).toBe(1)
    expect(costMicrousd(haiku, { input_tokens: 3, output_tokens: 0 })).toBe(1)
  })

  it('is zero for no tokens', () => {
    expect(costMicrousd(sonnet, { input_tokens: 0, output_tokens: 0 })).toBe(0)
  })

  it('prices cache writes at 1.25x and cache reads at the model’s multiple', () => {
    expect(
      costMicrousd(sonnet, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1000,
      }),
    ).toBe(2500)
    expect(
      costMicrousd(sonnet, {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1000,
      }),
    ).toBe(100)
    expect(
      costMicrousd(haiku, {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1000,
      }),
    ).toBe(10)
  })

  it('treats missing cache fields as zero', () => {
    expect(costMicrousd(sonnet, { input_tokens: 10, output_tokens: 10 })).toBe(
      120,
    )
  })

  it('returns a whole number for any realistic usage', () => {
    for (let n = 0; n < 200; n += 1) {
      const cost = costMicrousd(haiku, {
        input_tokens: n * 37,
        output_tokens: n * 11,
      })
      expect(Number.isInteger(cost)).toBe(true)
      expect(cost).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('estimateMicrousd', () => {
  it('is at least what the full output allowance costs', () => {
    expect(estimateMicrousd(sonnet, 0)).toBe(MAX_OUTPUT_TOKENS * 10)
    expect(estimateMicrousd(haiku, 0)).toBe(Math.ceil(MAX_OUTPUT_TOKENS * 0.5))
  })

  it('over-estimates a typical draft (about 1,000 input and 300 output tokens)', () => {
    const typical = costMicrousd(sonnet, {
      input_tokens: 1000,
      output_tokens: 300,
    })
    expect(estimateMicrousd(sonnet, 3000)).toBeGreaterThanOrEqual(typical)
  })

  it('grows with the input', () => {
    expect(estimateMicrousd(sonnet, 6000)).toBeGreaterThan(
      estimateMicrousd(sonnet, 3000),
    )
  })
})

describe('messagesRequestBody', () => {
  it('has one user message, a capped output and no sampling parameters', () => {
    const body = messagesRequestBody({
      model: sonnet,
      system: 'SYS',
      user: 'USER',
    })
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 450,
      thinking: { type: 'between_tools' },
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
    })
    for (const key of [
      'temperature',
      'top_p',
      'top_k',
      'stream',
      'tools',
      'cache_control',
    ]) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('turns thinking off in the way each model accepts', () => {
    expect(
      messagesRequestBody({ model: sonnet, system: '', user: '' }).thinking,
    ).toEqual({
      type: 'between_tools',
    })
    expect(
      messagesRequestBody({ model: haiku, system: '', user: '' }).thinking,
    ).toEqual({
      type: 'disabled',
    })
  })
})
