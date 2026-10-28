import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

const calls: { method: string; args: unknown[] }[] = []
let result: Result = { data: [], error: null }

const chain: object = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (property === 'then') {
        return (resolve: (value: Result) => unknown) => resolve(result)
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

const { listSchedulesBetween } = await import('./scheduled-posts')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  project_id: 'p1',
  draft_id: null,
  body: 'A scheduled post',
  channel_label: 'My LinkedIn',
  scheduled_for: '2026-10-28T10:00:00Z',
  buffer_post_id: null,
  status: 'scheduled',
  failure_code: null,
  created_at: '2026-10-27T10:00:00Z',
  ...over,
})

beforeEach(() => {
  calls.length = 0
  result = { data: [row()], error: null }
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('listSchedulesBetween', () => {
  it('reads only the user’s own schedules in the range, without canceled ones', async () => {
    const posts = await listSchedulesBetween(
      U,
      '2026-10-26T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    )
    expect(posts).toEqual([
      expect.objectContaining({
        id: 's1',
        body: 'A scheduled post',
        status: 'scheduled',
        scheduledFor: '2026-10-28T10:00:00Z',
      }),
    ])
    const used = (method: string) =>
      calls.filter((c) => c.method === method).map((c) => c.args)
    expect(used('from')).toEqual([['scheduled_posts']])
    expect(used('eq')).toEqual([['user_id', U]])
    expect(used('gte')).toEqual([['scheduled_for', '2026-10-26T00:00:00.000Z']])
    expect(used('lt')).toEqual([['scheduled_for', '2026-11-02T00:00:00.000Z']])
    expect(used('neq')).toEqual([['status', 'canceled']])
    expect(used('order')).toEqual([['scheduled_for', { ascending: true }]])
    expect(used('limit')).toEqual([[200]])
  })

  it('null on a database error, logging only the code', async () => {
    result = { data: null, error: { code: '42501' } }
    expect(await listSchedulesBetween(U, 'a', 'b')).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      'scheduling: query failed',
      '42501',
    )
  })

  it('null on a row with an unknown status', async () => {
    result = { data: [row({ status: 'weird' })], error: null }
    expect(await listSchedulesBetween(U, 'a', 'b')).toBeNull()
  })
})
