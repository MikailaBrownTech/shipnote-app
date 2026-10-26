import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteAuthUser = vi.fn()
const rateLimit = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./supabase-admin', () => ({ deleteAuthUser }))
vi.mock('./rate-limit', () => ({ rateLimit }))

const { deleteAccount } = await import('./delete-account')

const NOW = 1_800_000_000_000
const user = {
  id: 'user-1',
  email: 'Ada@Example.com',
  signedInAt: NOW / 1000 - 60,
}

describe('deleteAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimit.mockResolvedValue(true)
    deleteAuthUser.mockResolvedValue(true)
  })

  it('rejects the wrong confirmation text', async () => {
    expect(await deleteAccount(user, { confirm: 'nope' }, NOW)).toBe('confirm')
    expect(await deleteAccount(user, {}, NOW)).toBe('confirm')
    expect(deleteAuthUser).not.toHaveBeenCalled()
  })

  it('rejects a stale sign-in, even with the right text', async () => {
    const stale = { ...user, signedInAt: NOW / 1000 - 11 * 60 }
    expect(await deleteAccount(stale, { confirm: user.email }, NOW)).toBe(
      'recent',
    )
    expect(deleteAuthUser).not.toHaveBeenCalled()
  })

  it('treats an unknown sign-in time as stale', async () => {
    const unknown = { ...user, signedInAt: null }
    expect(await deleteAccount(unknown, { confirm: user.email }, NOW)).toBe(
      'recent',
    )
  })

  it('is stopped by the rate limit before anything else', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await deleteAccount(user, { confirm: user.email }, NOW)).toBe(
      'limited',
    )
    expect(deleteAuthUser).not.toHaveBeenCalled()
  })

  it('deletes once on success, ignoring case and spaces', async () => {
    const outcome = await deleteAccount(
      user,
      { confirm: '  ada@example.com ' },
      NOW,
    )
    expect(outcome).toBe('deleted')
    expect(deleteAuthUser).toHaveBeenCalledExactlyOnceWith('user-1')
  })

  it('reports a failed admin call without throwing', async () => {
    deleteAuthUser.mockResolvedValue(false)
    expect(await deleteAccount(user, { confirm: user.email }, NOW)).toBe(
      'failed',
    )
  })
})
