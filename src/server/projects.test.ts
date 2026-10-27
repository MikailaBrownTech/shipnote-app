import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }
const calls: { method: string; args: unknown[] }[] = []
let result: Result = { data: null, error: null }

// A stand-in for the Supabase query builder: every method records itself and
// returns the same chainable object, which resolves to `result` when awaited.
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

const {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
  PROJECT_LIMIT_SQLSTATE,
} = await import('./projects')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const input = {
  name: 'Shipnote',
  summary: null,
  stage: 'idea' as const,
  notes: 'private notes',
}
const row = {
  id: ID,
  name: 'Shipnote',
  summary: null,
  stage: 'idea',
  notes: 'private notes',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T11:00:00Z',
}

const called = (method: string) => calls.filter((c) => c.method === method)

describe('projects store', () => {
  beforeEach(() => {
    calls.length = 0
    result = { data: null, error: null }
    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('lists the user’s projects, newest first, as camelCase', async () => {
    result = { data: [row], error: null }
    const listed = await listProjects(USER)
    expect(listed).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: ID,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      ],
    })
    expect(called('eq')[0]?.args).toEqual(['user_id', USER])
    expect(called('order')[0]?.args).toEqual([
      'updated_at',
      { ascending: false },
    ])
  })

  it('returns failed, not an exception, when the query errors', async () => {
    result = { data: null, error: { code: '42501' } }
    expect(await listProjects(USER)).toEqual({ ok: false, reason: 'failed' })
  })

  it('returns failed if a row has an unexpected shape', async () => {
    result = { data: [{ ...row, stage: 'weird' }], error: null }
    expect(await listProjects(USER)).toEqual({ ok: false, reason: 'failed' })
  })

  it('get: filters by id and user, and a missing row is not_found', async () => {
    result = { data: null, error: null }
    expect(await getProject(USER, ID)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', ID],
      ['user_id', USER],
    ])
  })

  it('get: a bad id never reaches the database', async () => {
    expect(await getProject(USER, "1' or '1'='1")).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(calls).toHaveLength(0)
  })

  it('get: returns the project', async () => {
    result = { data: row, error: null }
    const found = await getProject(USER, ID)
    expect(found.ok && found.value.name).toBe('Shipnote')
  })

  it('create: sets user_id from the session user, never from the input', async () => {
    result = { data: row, error: null }
    const created = await createProject(USER, input)
    expect(created.ok).toBe(true)
    expect(called('insert')[0]?.args[0]).toEqual({ user_id: USER, ...input })
  })

  it('create: the database cap becomes reason "limit"', async () => {
    result = { data: null, error: { code: PROJECT_LIMIT_SQLSTATE } }
    expect(await createProject(USER, input)).toEqual({
      ok: false,
      reason: 'limit',
    })
  })

  it('create: any other error is a generic failure', async () => {
    result = { data: null, error: { code: '23514' } }
    expect(await createProject(USER, input)).toEqual({
      ok: false,
      reason: 'failed',
    })
  })

  it('update: never sends user_id or id as fields, and scopes by both', async () => {
    result = { data: row, error: null }
    await updateProject(USER, ID, input)
    expect(called('update')[0]?.args[0]).toEqual(input)
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', ID],
      ['user_id', USER],
    ])
  })

  it('update: a foreign or missing id (no row back) is not_found', async () => {
    result = { data: null, error: null }
    expect(await updateProject(USER, ID, input)).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('delete: no row deleted is not_found, one row is ok', async () => {
    result = { data: [], error: null }
    expect(await deleteProject(USER, ID)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    result = { data: [{ id: ID }], error: null }
    expect(await deleteProject(USER, ID)).toEqual({ ok: true, value: null })
  })

  it('a bad id is not_found for update and delete without a query', async () => {
    expect(await updateProject(USER, 'nope', input)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await deleteProject(USER, 'nope')).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(calls).toHaveLength(0)
  })

  it('logs only a fixed message and an error code, never project text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    result = { data: null, error: { code: '23514' } }
    await createProject(USER, input)
    await listProjects(USER)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('private notes')
    expect(logged).not.toContain('Shipnote')
    expect(warn).toHaveBeenCalledWith('projects: query failed', '23514')
  })
})
