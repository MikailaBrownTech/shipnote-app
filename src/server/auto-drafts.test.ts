import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

const calls: { method: string; args: unknown[] }[] = []
const queue: Result[] = []
const getAutoDraftsEnv = vi.fn()
const autoDraftsEnabled = vi.fn()

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
vi.mock('./env', () => ({ getAutoDraftsEnv, autoDraftsEnabled }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: (table: string) => {
        calls.push({ method: 'from', args: [table] })
        return chain
      },
    }),
}))

const {
  autoDraftsConfig,
  autoDraftsOn,
  listAutoJobs,
  readAutoDraft,
  setAutoDraft,
} = await import('./auto-drafts')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const P = '22222222-3333-4444-8555-666666666666'
const called = (method: string) => calls.filter((c) => c.method === method)

beforeEach(() => {
  calls.length = 0
  queue.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('the settings', () => {
  it('passes on the flag and the settings', () => {
    autoDraftsEnabled.mockReturnValue(true)
    getAutoDraftsEnv.mockReturnValue({ webhookSecret: 'x' })
    expect(autoDraftsOn()).toBe(true)
    expect(autoDraftsConfig()).toEqual({ webhookSecret: 'x' })
    autoDraftsEnabled.mockReturnValue(false)
    getAutoDraftsEnv.mockReturnValue(null)
    expect(autoDraftsOn()).toBe(false)
    expect(autoDraftsConfig()).toBeNull()
  })
})

describe('setAutoDraft', () => {
  it('changes only the switch, on the user’s own project', async () => {
    queue.push({ data: [{ id: P }], error: null })
    expect(await setAutoDraft(U, P, true)).toBe('ok')
    expect(called('update')[0]?.args).toEqual([{ auto_draft: true }])
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', P],
      ['user_id', U],
    ])
  })

  it('no matching row is not found, and an error is failed', async () => {
    queue.push({ data: [], error: null })
    expect(await setAutoDraft(U, P, false)).toBe('not_found')
    queue.push({ data: null, error: { code: '42501' } })
    expect(await setAutoDraft(U, P, true)).toBe('failed')
    expect(console.warn).toHaveBeenCalledWith(
      'auto drafts: query failed',
      '42501',
    )
  })
})

describe('readAutoDraft', () => {
  it('reads the switch of the user’s own project', async () => {
    queue.push({ data: { auto_draft: true }, error: null })
    expect(await readAutoDraft(U, P)).toBe(true)
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', P],
      ['user_id', U],
    ])
  })

  it('null when it cannot be read or is not there', async () => {
    queue.push({ data: null, error: null })
    expect(await readAutoDraft(U, P)).toBeNull()
    queue.push({ data: null, error: { code: 'x' } })
    expect(await readAutoDraft(U, P)).toBeNull()
    queue.push({ data: { auto_draft: 'yes' }, error: null })
    expect(await readAutoDraft(U, P)).toBeNull()
  })
})

describe('listAutoJobs', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'j1',
    commit_sha: 'a'.repeat(40),
    status: 'skipped',
    reason: 'daily_limit',
    draft_id: null,
    created_at: '2026-11-03T10:00:00Z',
    ...over,
  })

  it('reads the user’s own jobs for the project, newest first, with identifiers and codes only', async () => {
    queue.push({ data: [row()], error: null })
    expect(await listAutoJobs(U, P)).toEqual([
      {
        id: 'j1',
        commitSha: 'a'.repeat(40),
        status: 'skipped',
        reason: 'daily_limit',
        draftId: null,
        createdAt: '2026-11-03T10:00:00Z',
      },
    ])
    expect(called('select')[0]?.args).toEqual([
      'id, commit_sha, status, reason, draft_id, created_at',
    ])
    expect(called('eq').map((c) => c.args)).toEqual([
      ['user_id', U],
      ['project_id', P],
    ])
    expect(called('order')[0]?.args).toEqual([
      'created_at',
      { ascending: false },
    ])
    expect(called('limit')[0]?.args).toEqual([20])
  })

  it('null on an error or an odd row', async () => {
    queue.push({ data: null, error: { code: '42501' } })
    expect(await listAutoJobs(U, P)).toBeNull()
    queue.push({ data: [row({ status: 'weird' })], error: null })
    expect(await listAutoJobs(U, P)).toBeNull()
    queue.push({ data: [{ id: 'j' }], error: null })
    expect(await listAutoJobs(U, P)).toBeNull()
  })
})
