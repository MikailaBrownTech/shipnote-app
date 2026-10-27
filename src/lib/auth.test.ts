import { beforeEach, describe, expect, it, vi } from 'vitest'

const getClaims = vi.fn()
const sessionStillActive = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { getClaims } }),
}))
vi.mock('@/server/session-check', () => ({ sessionStillActive }))

const { getCurrentUser, requireUser } = await import('./auth')

const claims = {
  sub: 'user-1',
  email: 'ada@example.com',
  session_id: 'session-1',
  amr: [{ method: 'otp', timestamp: 1_800_000_000 }],
}

describe('getCurrentUser / requireUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getClaims.mockResolvedValue({ data: { claims }, error: null })
    sessionStillActive.mockResolvedValue(true)
  })

  it('accepts a valid token whose session still exists', async () => {
    expect(await requireUser()).toEqual({
      id: 'user-1',
      email: 'ada@example.com',
      signedInAt: 1_800_000_000,
    })
    expect(sessionStillActive).toHaveBeenCalledExactlyOnceWith(
      'session-1',
      'user-1',
    )
  })

  it('rejects a revoked session even though the token still verifies', async () => {
    // getClaims() passes: the signature and expiry are fine. The session is gone.
    sessionStillActive.mockResolvedValue(false)
    expect(await getCurrentUser()).toBeNull()
    await expect(requireUser()).rejects.toThrow('redirect:/sign-in')
  })

  it('rejects a deleted account (the same check covers deleted_at)', async () => {
    sessionStillActive.mockResolvedValue(false)
    await expect(requireUser()).rejects.toThrow('redirect:/sign-in')
  })

  it('rejects a token with no session_id without asking the database', async () => {
    getClaims.mockResolvedValue({
      data: { claims: { ...claims, session_id: undefined } },
      error: null,
    })
    expect(await getCurrentUser()).toBeNull()
    expect(sessionStillActive).not.toHaveBeenCalled()
  })

  it('rejects when the token does not verify', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('bad') })
    expect(await getCurrentUser()).toBeNull()
    expect(sessionStillActive).not.toHaveBeenCalled()
  })
})
