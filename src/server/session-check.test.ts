import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const deleteUser = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.test',
    NEXT_PUBLIC_SITE_URL: 'https://shipnote.test',
  },
}))
vi.mock('./env', () => ({
  getAdminEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc, auth: { admin: { deleteUser } } }),
}))

const {
  isSessionActive,
  countSessions,
  softDeleteAuthUser,
  hardDeleteAuthUser,
} = await import('./supabase-admin')

describe('isSessionActive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is true only for an explicit true', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await isSessionActive('s', 'u')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('session_is_active', {
      p_session_id: 's',
      p_user_id: 'u',
    })
  })

  it.each([
    ['false', { data: false, error: null }],
    ['null', { data: null, error: null }],
    ['a string', { data: 'true', error: null }],
    ['an error', { data: true, error: { message: 'down' } }],
  ])('fails closed on %s', async (_label, response) => {
    rpc.mockResolvedValue(response)
    expect(await isSessionActive('s', 'u')).toBe(false)
  })
})

describe('countSessions', () => {
  it('returns the number, or null when it cannot be read', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    expect(await countSessions('u')).toBe(0)
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await countSessions('u')).toBeNull()
    rpc.mockResolvedValue({ data: 'many', error: null })
    expect(await countSessions('u')).toBeNull()
  })
})

describe('deleting a user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteUser.mockResolvedValue({ data: {}, error: null })
  })

  it('soft delete asks Supabase to soft-delete, once', async () => {
    expect(await softDeleteAuthUser('u')).toBe(true)
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith('u', true)
  })

  it('reports failure without throwing', async () => {
    deleteUser.mockResolvedValue({ data: null, error: { message: 'no' } })
    expect(await softDeleteAuthUser('u')).toBe(false)
  })

  it('only the new-account backstop does a hard delete', async () => {
    expect(await hardDeleteAuthUser('u')).toBe(true)
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith('u')
  })
})
