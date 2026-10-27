import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
let next: Result = { data: null, error: null }

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.test' },
}))
vi.mock('./env', () => ({
  getAdminEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(next)
    },
  }),
}))

const {
  completeGeneration,
  generationsUsedToday,
  recordUnusableGeneration,
  releaseGeneration,
  reserveGeneration,
} = await import('./supabase-admin')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const reserve = {
  userId: U,
  estimatedMicrousd: 3000,
  dailyLimit: 10,
  monthlyCapMicrousd: 10_000_000,
}

beforeEach(() => {
  rpcCalls.length = 0
  next = { data: null, error: null }
})

describe('reserveGeneration', () => {
  it('passes the limits to the database function and returns the usage id', async () => {
    next = { data: 'usage-1', error: null }
    expect(await reserveGeneration(reserve)).toEqual({
      ok: true,
      usageId: 'usage-1',
    })
    expect(rpcCalls).toEqual([
      {
        name: 'reserve_generation',
        args: {
          p_user_id: U,
          p_estimated_microusd: 3000,
          p_daily_limit: 10,
          p_monthly_cap_microusd: 10_000_000,
        },
      },
    ])
  })

  it('maps the daily limit and the monthly cap to their own reasons', async () => {
    next = { data: null, error: { code: 'SN010' } }
    expect(await reserveGeneration(reserve)).toEqual({
      ok: false,
      reason: 'daily_limit',
    })
    next = { data: null, error: { code: 'SN011' } }
    expect(await reserveGeneration(reserve)).toEqual({
      ok: false,
      reason: 'monthly_cap',
    })
  })

  it('FAILS CLOSED on any other error and on an odd answer', async () => {
    for (const result of [
      { data: null, error: { code: 'XX000' } },
      { data: null, error: { code: 'SN012' } },
      { data: null, error: null },
      { data: '', error: null },
      { data: 42, error: null },
      { data: { id: 'x' }, error: null },
    ]) {
      next = result
      expect(await reserveGeneration(reserve)).toEqual({
        ok: false,
        reason: 'failed',
      })
    }
  })
})

describe('completeGeneration', () => {
  const input = {
    usageId: 'usage-1',
    userId: U,
    projectId: 'p',
    body: 'Text',
    model: 'claude-sonnet-5-5',
    inputTokens: 800,
    outputTokens: 230,
    costMicrousd: 3900,
    commitShas: ['abc1234'],
  }

  it('writes the draft in one database call and returns its id', async () => {
    next = { data: 'draft-1', error: null }
    expect(await completeGeneration(input)).toBe('draft-1')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      name: 'complete_generation',
      args: {
        p_usage_id: 'usage-1',
        p_user_id: U,
        p_project_id: 'p',
        p_body: 'Text',
        p_model: 'claude-sonnet-5-5',
        p_input_tokens: 800,
        p_output_tokens: 230,
        p_cost_microusd: 3900,
        p_commit_shas: ['abc1234'],
      },
    })
  })

  it('returns null on an error or an odd answer', async () => {
    next = { data: null, error: { code: 'SN013' } }
    expect(await completeGeneration(input)).toBeNull()
    next = { data: 5, error: null }
    expect(await completeGeneration(input)).toBeNull()
    next = { data: 'draft-1', error: { code: 'XX000' } }
    expect(await completeGeneration(input)).toBeNull()
  })
})

describe('recording, releasing and counting', () => {
  it('records an unusable answer with its cost', async () => {
    expect(await recordUnusableGeneration('usage-1', U, 3900)).toBe(true)
    expect(rpcCalls[0]).toEqual({
      name: 'record_unusable_generation',
      args: { p_usage_id: 'usage-1', p_user_id: U, p_cost_microusd: 3900 },
    })
    next = { data: null, error: { code: 'XX000' } }
    expect(await recordUnusableGeneration('usage-1', U, 1)).toBe(false)
  })

  it('releases a reservation for the same user only', async () => {
    expect(await releaseGeneration('usage-1', U)).toBe(true)
    expect(rpcCalls[0]).toEqual({
      name: 'release_generation',
      args: { p_usage_id: 'usage-1', p_user_id: U },
    })
    next = { data: null, error: { code: 'XX000' } }
    expect(await releaseGeneration('usage-1', U)).toBe(false)
  })

  it('counts today’s generations, or null when it cannot', async () => {
    next = { data: 4, error: null }
    expect(await generationsUsedToday(U)).toBe(4)
    expect(rpcCalls[0]).toEqual({
      name: 'generations_used_today',
      args: { p_user_id: U },
    })
    next = { data: '4', error: null }
    expect(await generationsUsedToday(U)).toBeNull()
    next = { data: 4, error: { code: 'XX000' } }
    expect(await generationsUsedToday(U)).toBeNull()
  })
})
