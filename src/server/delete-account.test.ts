import { beforeEach, describe, expect, it, vi } from 'vitest'

const softDeleteAuthUser = vi.fn()
const rateLimit = vi.fn()
const cleanupForDeletion = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./supabase-admin', () => ({ softDeleteAuthUser }))
vi.mock('./rate-limit', () => ({ rateLimit }))
vi.mock('./scheduling', () => ({ cleanupForDeletion }))

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
    softDeleteAuthUser.mockResolvedValue(true)
    cleanupForDeletion.mockResolvedValue({
      canceled: 0,
      couldNotCancel: 0,
      hadConnection: false,
    })
  })

  it('rejects the wrong confirmation text', async () => {
    expect(await deleteAccount(user, { confirm: 'nope' }, NOW)).toBe('confirm')
    expect(await deleteAccount(user, {}, NOW)).toBe('confirm')
    expect(softDeleteAuthUser).not.toHaveBeenCalled()
  })

  it('rejects a stale sign-in, even with the right text', async () => {
    const stale = { ...user, signedInAt: NOW / 1000 - 11 * 60 }
    expect(await deleteAccount(stale, { confirm: user.email }, NOW)).toBe(
      'recent',
    )
    expect(softDeleteAuthUser).not.toHaveBeenCalled()
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
    expect(softDeleteAuthUser).not.toHaveBeenCalled()
  })

  it('deletes once on success, ignoring case and spaces', async () => {
    const outcome = await deleteAccount(
      user,
      { confirm: '  ada@example.com ' },
      NOW,
    )
    expect(outcome).toBe('deleted')
    expect(softDeleteAuthUser).toHaveBeenCalledExactlyOnceWith('user-1')
  })

  it('reports a failed admin call without throwing', async () => {
    softDeleteAuthUser.mockResolvedValue(false)
    expect(await deleteAccount(user, { confirm: user.email }, NOW)).toBe(
      'failed',
    )
  })

  describe('the Buffer cleanup', () => {
    it('runs for this user BEFORE the account is soft-deleted, and reports what it found', async () => {
      const result = { canceled: 1, couldNotCancel: 2, hadConnection: true }
      cleanupForDeletion.mockResolvedValue(result)
      const seen: unknown[] = []
      const outcome = await deleteAccount(
        user,
        { confirm: user.email },
        NOW,
        (r) => seen.push(r),
      )
      expect(outcome).toBe('deleted')
      expect(cleanupForDeletion).toHaveBeenCalledExactlyOnceWith('user-1')
      expect(seen).toEqual([result])
      expect(cleanupForDeletion.mock.invocationCallOrder[0]).toBeLessThan(
        softDeleteAuthUser.mock.invocationCallOrder[0] ?? 0,
      )
    })

    it('a failure in the cleanup never blocks the deletion', async () => {
      cleanupForDeletion.mockRejectedValue(new Error('Buffer exploded'))
      const seen: unknown[] = []
      const outcome = await deleteAccount(
        user,
        { confirm: user.email },
        NOW,
        (r) => seen.push(r),
      )
      expect(outcome).toBe('deleted')
      expect(softDeleteAuthUser).toHaveBeenCalledOnce()
      // It assumes there was a connection, so the person is still told.
      expect(seen).toEqual([
        { canceled: 0, couldNotCancel: 0, hadConnection: true },
      ])
    })

    it('does not run when the deletion is refused', async () => {
      await deleteAccount(user, { confirm: 'nope' }, NOW)
      await deleteAccount(
        { ...user, signedInAt: null },
        { confirm: user.email },
        NOW,
      )
      rateLimit.mockResolvedValue(false)
      await deleteAccount(user, { confirm: user.email }, NOW)
      expect(cleanupForDeletion).not.toHaveBeenCalled()
      expect(softDeleteAuthUser).not.toHaveBeenCalled()
    })

    it('logs nothing', async () => {
      const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => undefined),
      )
      cleanupForDeletion.mockRejectedValue(new Error('x'))
      await deleteAccount(user, { confirm: user.email }, NOW)
      expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([])
    })
  })
})
