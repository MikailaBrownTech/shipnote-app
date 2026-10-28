import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

const calls: { method: string; args: unknown[] }[] = []
const queue: Result[] = []

const chain: object = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (property === 'then') {
        return (resolve: (value: Result) => unknown) =>
          resolve(queue.shift() ?? { data: [], error: null })
      }
      return (...args: unknown[]) => {
        calls.push({ method: property, args })
        return chain
      }
    },
  },
)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: (table: string) => {
        calls.push({ method: 'from', args: [table] })
        return chain
      },
    }),
}))

const { readVoice, resetVoice, saveVoice } = await import('./voice')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const called = (method: string) => calls.filter((c) => c.method === method)

const voice = {
  tone: 'casual' as const,
  notes: 'Short and dry.',
  samples: ['One'],
  avoidWords: ['synergy'],
  signoff: 'Cheers',
}
const stored = {
  tone: 'casual',
  voice_notes: 'Short and dry.',
  sample_posts: ['One'],
  avoid_words: ['synergy'],
  signoff: 'Cheers',
}

beforeEach(() => {
  calls.length = 0
  queue.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('readVoice', () => {
  it('reads only the user’s own row', async () => {
    queue.push({ data: stored, error: null })
    expect(await readVoice(U)).toEqual(voice)
    expect(called('from')[0]?.args).toEqual(['voice_profiles'])
    expect(called('eq').map((c) => c.args)).toEqual([['user_id', U]])
  })

  it('null when there is no row, failed when it cannot be read or is odd', async () => {
    queue.push({ data: null, error: null })
    expect(await readVoice(U)).toBeNull()
    queue.push({ data: null, error: { code: '42501' } })
    expect(await readVoice(U)).toBe('failed')
    expect(console.warn).toHaveBeenCalledWith('voice: query failed', '42501')
    queue.push({ data: { ...stored, tone: 'weird' }, error: null })
    expect(await readVoice(U)).toBe('failed')
  })
})

describe('saveVoice', () => {
  it('changes the user’s existing row, never touching user_id', async () => {
    queue.push({ data: [{ user_id: U }], error: null })
    expect(await saveVoice(U, voice)).toBe('ok')
    expect(called('update')[0]?.args).toEqual([stored])
    expect(called('eq').map((c) => c.args)).toEqual([['user_id', U]])
    expect(called('insert')).toHaveLength(0)
  })

  it('makes the row when there is none', async () => {
    queue.push({ data: [], error: null })
    queue.push({ data: null, error: null })
    expect(await saveVoice(U, voice)).toBe('ok')
    expect(called('insert')[0]?.args).toEqual([{ user_id: U, ...stored }])
  })

  it('if another request made the row first, changes it instead', async () => {
    queue.push({ data: [], error: null })
    queue.push({ data: null, error: { code: '23505' } })
    queue.push({ data: [{ user_id: U }], error: null })
    expect(await saveVoice(U, voice)).toBe('ok')
    expect(called('update')).toHaveLength(2)
  })

  it('failed on any other error, logging only the code', async () => {
    queue.push({ data: null, error: { code: '42501' } })
    expect(await saveVoice(U, voice)).toBe('failed')
    queue.push({ data: [], error: null })
    queue.push({ data: null, error: { code: '23514' } })
    expect(await saveVoice(U, voice)).toBe('failed')
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls)
    expect(logged).toContain('23514')
    expect(logged).not.toContain('Short and dry')
  })
})

describe('resetVoice', () => {
  it('deletes only the user’s own row', async () => {
    queue.push({ data: null, error: null })
    expect(await resetVoice(U)).toBe('ok')
    expect(called('delete')).toHaveLength(1)
    expect(called('eq').map((c) => c.args)).toEqual([['user_id', U]])
  })

  it('failed on an error', async () => {
    queue.push({ data: null, error: { code: 'x' } })
    expect(await resetVoice(U)).toBe('failed')
  })
})
