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

const { listUserPosts, POSTS_READ_LIMIT } = await import('./posts')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  project_id: 'p1',
  body: 'A draft',
  status: 'draft',
  created_at: '2026-10-27T09:00:00Z',
  ...over,
})
const scheduleRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  project_id: 'p1',
  draft_id: null,
  body: 'A schedule',
  status: 'scheduled',
  scheduled_for: '2026-10-30T10:00:00Z',
  created_at: '2026-10-27T10:00:00Z',
  ...over,
})

beforeEach(() => {
  calls.length = 0
  queue.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('listUserPosts', () => {
  it('reads only the user’s own drafts and schedules, newest first, with a limit', async () => {
    queue.push({ data: [draftRow()], error: null })
    queue.push({ data: [scheduleRow()], error: null })
    const result = await listUserPosts(U)
    expect(result).toEqual({
      drafts: [
        {
          id: 'd1',
          projectId: 'p1',
          body: 'A draft',
          status: 'draft',
          createdAt: '2026-10-27T09:00:00Z',
        },
      ],
      schedules: [
        {
          id: 's1',
          projectId: 'p1',
          draftId: null,
          body: 'A schedule',
          status: 'scheduled',
          scheduledFor: '2026-10-30T10:00:00Z',
          createdAt: '2026-10-27T10:00:00Z',
        },
      ],
      truncated: false,
    })
    expect(
      calls.filter((c) => c.method === 'from').map((c) => c.args[0]),
    ).toEqual(['drafts', 'scheduled_posts'])
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['user_id', U],
      ['user_id', U],
    ])
    expect(calls.filter((c) => c.method === 'limit')[0]?.args).toEqual([
      POSTS_READ_LIMIT,
    ])
  })

  it('says when a list was cut at the limit', async () => {
    queue.push({
      data: Array.from({ length: POSTS_READ_LIMIT }, (_, i) =>
        draftRow({ id: `d${String(i)}` }),
      ),
      error: null,
    })
    queue.push({ data: [], error: null })
    expect((await listUserPosts(U))?.truncated).toBe(true)
  })

  it('null on a database error, logging only the code', async () => {
    queue.push({ data: null, error: { code: '42501' } })
    queue.push({ data: [], error: null })
    expect(await listUserPosts(U)).toBeNull()
    expect(console.warn).toHaveBeenCalledWith('posts: query failed', '42501')
    queue.push({ data: [], error: null })
    queue.push({ data: null, error: { code: 'x' } })
    expect(await listUserPosts(U)).toBeNull()
  })

  it('null on a row with an unknown status', async () => {
    queue.push({ data: [draftRow({ status: 'weird' })], error: null })
    queue.push({ data: [], error: null })
    expect(await listUserPosts(U)).toBeNull()
    queue.push({ data: [], error: null })
    queue.push({ data: [scheduleRow({ status: 'weird' })], error: null })
    expect(await listUserPosts(U)).toBeNull()
  })
})
