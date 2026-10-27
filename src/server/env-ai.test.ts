import { describe, expect, it } from 'vitest'
import { isAiEnabled, parseAiEnv } from './env-schema'

const KEY = 'sk-ant-api03-' + 'aB3xY9'.repeat(6)
const on = { AI_ENABLED: 'true', ANTHROPIC_API_KEY: KEY }

describe('parseAiEnv', () => {
  it('is null when the flag is off or unset, whatever else is set', () => {
    expect(parseAiEnv({})).toBeNull()
    expect(parseAiEnv({ AI_ENABLED: 'false' })).toBeNull()
    expect(parseAiEnv({ AI_ENABLED: '' })).toBeNull()
    expect(
      parseAiEnv({ AI_ENABLED: 'false', ANTHROPIC_API_KEY: 'junk' }),
    ).toBeNull()
  })

  it('rejects a flag that is neither true nor false', () => {
    expect(() => parseAiEnv({ AI_ENABLED: 'yes' })).toThrow(
      /AI_ENABLED must be true or false/,
    )
  })

  it('needs only the key when on: the model and the cap have defaults', () => {
    expect(parseAiEnv(on)).toEqual({
      apiKey: KEY,
      model: 'claude-sonnet-5-5',
      monthlyCapMicrousd: 10_000_000,
    })
  })

  it('names the key when it is missing, without printing anything else', () => {
    expect(() => parseAiEnv({ AI_ENABLED: 'true' })).toThrow(
      /ANTHROPIC_API_KEY is missing/,
    )
    expect(() =>
      parseAiEnv({ AI_ENABLED: 'true', ANTHROPIC_API_KEY: '   ' }),
    ).toThrow(/ANTHROPIC_API_KEY is missing/)
  })

  it.each([
    ['too short', 'short'],
    ['has a space', `${KEY} extra`],
    ['has a line break', `${KEY}\nX-Evil: 1`],
    ['has a control character', `${KEY}\u0000`],
  ])('refuses a key that %s, without echoing it', (_label, key) => {
    let message = ''
    try {
      parseAiEnv({ ...on, ANTHROPIC_API_KEY: key })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/ANTHROPIC_API_KEY is (invalid|missing)/)
    expect(message).not.toContain(key.trim())
  })

  it('takes either supported model, and prices it', () => {
    expect(
      parseAiEnv({ ...on, ANTHROPIC_MODEL: 'claude-haiku-5-5' })?.model,
    ).toBe('claude-haiku-5-5')
    expect(
      parseAiEnv({ ...on, ANTHROPIC_MODEL: 'claude-sonnet-5-5' })?.model,
    ).toBe('claude-sonnet-5-5')
  })

  it.each(['gpt-4', 'claude-opus-5-5', 'claude-3-haiku', '../x', '__proto__'])(
    'refuses the model %s, whose price is not known',
    (model) => {
      expect(() => parseAiEnv({ ...on, ANTHROPIC_MODEL: model })).toThrow(
        /ANTHROPIC_MODEL is invalid/,
      )
    },
  )

  it.each([
    ['10', 10_000_000],
    ['25', 25_000_000],
    ['0.5', 500_000],
    ['3.25', 3_250_000],
    ['100000', 100_000_000_000],
  ])('turns a cap of $%s into %s micro-dollars', (usd, micro) => {
    expect(
      parseAiEnv({ ...on, AI_MONTHLY_CAP_USD: usd })?.monthlyCapMicrousd,
    ).toBe(micro)
  })

  it.each([
    '0',
    '0.00',
    '-5',
    'ten',
    '1e3',
    '1,000',
    '5.123',
    '1000000',
    '$10',
  ])('refuses the cap %s', (cap) => {
    expect(() => parseAiEnv({ ...on, AI_MONTHLY_CAP_USD: cap })).toThrow(
      /AI_MONTHLY_CAP_USD is invalid/,
    )
  })
})

describe('isAiEnabled', () => {
  it('is true only for the word true', () => {
    expect(isAiEnabled({ AI_ENABLED: 'true' })).toBe(true)
    expect(isAiEnabled({ AI_ENABLED: ' TRUE ' })).toBe(true)
    for (const value of [undefined, '', 'false', '1', 'yes']) {
      expect(isAiEnabled({ AI_ENABLED: value })).toBe(false)
    }
  })
})
