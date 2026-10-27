import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code?: string } | null }

const calls: { method: string; args: unknown[] }[] = []
const queue: Result[] = []

// Every method records itself and returns the same chain; awaiting the chain
// takes the next queued result.
const chain: object = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (property === 'then') {
        return (resolve: (value: Result) => unknown) =>
          resolve(queue.shift() ?? { data: null, error: null })
      }
      return (...args: unknown[]) => {
        calls.push({ method: property, args })
        return chain
      }
    },
  },
)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.test' },
}))
vi.mock('./env', () => ({
  getAdminEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      return chain
    },
  }),
}))

const {
  linkProjectRepo,
  removeGithubInstallation,
  saveGithubInstallation,
  unlinkProjectRepo,
} = await import('./supabase-admin')

const U = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const OTHER = '11111111-2222-4333-8444-555555555555'
const P = '22222222-3333-4444-8555-666666666666'
const input = {
  userId: U,
  installationId: 42,
  accountLogin: 'octo',
  accountId: 7,
}

const called = (method: string) => calls.filter((c) => c.method === method)

describe('saveGithubInstallation', () => {
  beforeEach(() => {
    calls.length = 0
    queue.length = 0
  })

  it('inserts a new installation for the verified user', async () => {
    queue.push({ data: null, error: null }, { data: null, error: null })
    expect(await saveGithubInstallation(input)).toBe('saved')
    expect(called('insert')[0]?.args[0]).toEqual({
      user_id: U,
      installation_id: 42,
      account_login: 'octo',
      account_id: 7,
    })
  })

  it('refuses an installation that already belongs to another user, and changes nothing', async () => {
    queue.push({ data: { user_id: OTHER }, error: null })
    expect(await saveGithubInstallation(input)).toBe('taken')
    expect(called('insert')).toHaveLength(0)
    expect(called('update')).toHaveLength(0)
  })

  it('refreshes the details when the same user connects again', async () => {
    queue.push(
      { data: { user_id: U }, error: null },
      { data: null, error: null },
    )
    expect(await saveGithubInstallation(input)).toBe('saved')
    expect(called('insert')).toHaveLength(0)
    expect(called('update')).toHaveLength(1)
    expect(called('eq').map((c) => c.args)).toEqual([
      ['installation_id', 42],
      ['installation_id', 42],
      ['user_id', U],
    ])
  })

  it('a race lost to another user is "taken", not an error', async () => {
    queue.push(
      { data: null, error: null },
      { data: null, error: { code: '23505' } },
    )
    expect(await saveGithubInstallation(input)).toBe('taken')
  })

  it('any other database error is a plain failure', async () => {
    queue.push(
      { data: null, error: null },
      { data: null, error: { code: '42501' } },
    )
    expect(await saveGithubInstallation(input)).toBe('failed')
    queue.push({ data: null, error: { code: 'XX000' } })
    expect(await saveGithubInstallation(input)).toBe('failed')
  })
})

describe('the other narrow writes', () => {
  beforeEach(() => {
    calls.length = 0
    queue.length = 0
  })

  it('removes only the user’s own installation row', async () => {
    queue.push({ data: null, error: null })
    expect(await removeGithubInstallation(U, 42)).toBe(true)
    expect(called('from')[0]?.args).toEqual(['github_installations'])
    expect(called('delete')).toHaveLength(1)
    expect(called('eq').map((c) => c.args)).toEqual([
      ['user_id', U],
      ['installation_id', 42],
    ])
  })

  it('links a project scoped to the user, and reports whether one row changed', async () => {
    queue.push({ data: [{ id: P }], error: null })
    expect(
      await linkProjectRepo({
        userId: U,
        projectId: P,
        installationId: 42,
        repoFullName: 'octo/hi',
      }),
    ).toBe(true)
    expect(called('update')[0]?.args[0]).toEqual({
      installation_id: 42,
      repo_full_name: 'octo/hi',
    })
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', P],
      ['user_id', U],
    ])
  })

  it('link reports false for a project that is not the user’s (no row changed)', async () => {
    queue.push({ data: [], error: null })
    expect(
      await linkProjectRepo({
        userId: U,
        projectId: P,
        installationId: 42,
        repoFullName: 'octo/hi',
      }),
    ).toBe(false)
  })

  it('link reports false when the database refuses (for example the foreign key)', async () => {
    queue.push({ data: null, error: { code: '23503' } })
    expect(
      await linkProjectRepo({
        userId: U,
        projectId: P,
        installationId: 42,
        repoFullName: 'octo/hi',
      }),
    ).toBe(false)
  })

  it('unlinks by clearing both columns, scoped to the user', async () => {
    queue.push({ data: [{ id: P }], error: null })
    expect(await unlinkProjectRepo(U, P)).toBe(true)
    expect(called('update')[0]?.args[0]).toEqual({
      installation_id: null,
      repo_full_name: null,
    })
    expect(called('eq').map((c) => c.args)).toEqual([
      ['id', P],
      ['user_id', U],
    ])
  })
})
