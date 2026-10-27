import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

const calls: { method: string; args: unknown[] }[] = []
const queue: Result[] = []
const rpcCalls: { name: string; args: unknown }[] = []
let rpcResult: Result = { data: true, error: null }

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
      rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args })
        return Promise.resolve(rpcResult)
      },
    }),
}))

const {
  coveredShas,
  deleteDraft,
  listRecentDrafts,
  markDraftCopied,
  updateDraftBody,
} = await import('./drafts')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const P = '22222222-3333-4444-8555-666666666666'
const D = '99999999-2222-4333-8444-555555555555'
const called = (method: string) => calls.filter((c) => c.method === method)

const row = (over: Record<string, unknown> = {}) => ({
  id: D,
  project_id: P,
  body: 'Text',
  status: 'draft',
  model: 'claude-sonnet-5-5',
  created_at: '2026-10-27T09:00:00Z',
  copied_at: null,
  ...over,
})

beforeEach(() => {
  calls.length = 0
  queue.length = 0
  rpcCalls.length = 0
  rpcResult = { data: true, error: null }
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('listRecentDrafts', () => {
  it('reads the user’s own drafts for the project, newest first, with their commits', async () => {
    queue.push(
      { data: [row()], error: null },
      { data: [{ draft_id: D, commit_sha: 'abc1234' }], error: null },
    )
    expect(await listRecentDrafts(U, P)).toEqual([
      {
        id: D,
        projectId: P,
        body: 'Text',
        status: 'draft',
        model: 'claude-sonnet-5-5',
        createdAt: '2026-10-27T09:00:00Z',
        copiedAt: null,
        shas: ['abc1234'],
      },
    ])
    expect(called('from').map((c) => c.args[0])).toEqual([
      'drafts',
      'draft_commits',
    ])
    expect(called('eq').map((c) => c.args)).toEqual([
      ['user_id', U],
      ['project_id', P],
    ])
    expect(called('order')[0]?.args).toEqual([
      'created_at',
      { ascending: false },
    ])
    expect(called('limit')[0]?.args).toEqual([10])
  })

  it('makes one query, not two, when there are no drafts', async () => {
    queue.push({ data: [], error: null })
    expect(await listRecentDrafts(U, P)).toEqual([])
    expect(called('from')).toHaveLength(1)
  })

  it('returns null on an error or an odd row, logging only a code', async () => {
    queue.push({ data: null, error: { code: '42501' } })
    expect(await listRecentDrafts(U, P)).toBeNull()
    queue.push({ data: [{ id: D }], error: null })
    expect(await listRecentDrafts(U, P)).toBeNull()
    queue.push({ data: [row({ status: 'weird' })], error: null })
    expect(await listRecentDrafts(U, P)).toBeNull()
    expect(console.warn).toHaveBeenCalledWith('drafts: query failed', '42501')
  })

  it('returns null when the commit links cannot be read', async () => {
    queue.push(
      { data: [row()], error: null },
      { data: null, error: { code: 'XX000' } },
    )
    expect(await listRecentDrafts(U, P)).toBeNull()
  })
})

describe('coveredShas', () => {
  it('lists the commits of copied drafts only, each once', async () => {
    queue.push(
      { data: [{ id: D }, { id: 'e' }], error: null },
      {
        data: [
          { draft_id: D, commit_sha: 'abc1234' },
          { draft_id: 'e', commit_sha: 'abc1234' },
          { draft_id: 'e', commit_sha: 'def5678' },
        ],
        error: null,
      },
    )
    expect(await coveredShas(U, P)).toEqual(['abc1234', 'def5678'])
    expect(called('eq').map((c) => c.args)).toContainEqual(['status', 'copied'])
  })

  it('returns null on an error', async () => {
    queue.push({ data: null, error: { code: 'XX000' } })
    expect(await coveredShas(U, P)).toBeNull()
  })
})

describe('updateDraftBody and deleteDraft', () => {
  it('update only the caller’s own draft', async () => {
    queue.push({ data: [{ id: D }], error: null })
    expect(await updateDraftBody(U, D, 'New')).toBe('ok')
    expect(called('update')[0]?.args).toEqual([{ body: 'New' }])
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', D],
      ['user_id', U],
    ])
  })

  it('treat no matching row as not found, and an error as failed', async () => {
    queue.push({ data: [], error: null })
    expect(await updateDraftBody(U, D, 'x')).toBe('not_found')
    queue.push({ data: null, error: { code: 'XX000' } })
    expect(await updateDraftBody(U, D, 'x')).toBe('failed')
    queue.push({ data: [], error: null })
    expect(await deleteDraft(U, D)).toBe('not_found')
    queue.push({ data: null, error: { code: 'XX000' } })
    expect(await deleteDraft(U, D)).toBe('failed')
  })

  it('delete the caller’s own draft', async () => {
    queue.push({ data: [{ id: D }], error: null })
    expect(await deleteDraft(U, D)).toBe('ok')
    expect(called('delete')).toHaveLength(1)
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', D],
      ['user_id', U],
    ])
  })
})

describe('markDraftCopied', () => {
  it('calls the database function with the draft id only', async () => {
    expect(await markDraftCopied(D)).toBe('ok')
    expect(rpcCalls).toEqual([
      { name: 'mark_draft_copied', args: { p_draft_id: D } },
    ])
  })

  it('is not found when the function finds nothing, failed on an error', async () => {
    rpcResult = { data: false, error: null }
    expect(await markDraftCopied(D)).toBe('not_found')
    rpcResult = { data: null, error: { code: 'XX000' } }
    expect(await markDraftCopied(D)).toBe('failed')
  })
})

describe('logs', () => {
  it('never contain a draft body', async () => {
    queue.push({ data: [row({ body: 'PRIVATE DRAFT' })], error: { code: '1' } })
    await listRecentDrafts(U, P)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      'PRIVATE',
    )
  })
})
