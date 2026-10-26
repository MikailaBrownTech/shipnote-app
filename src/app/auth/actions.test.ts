import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOutMock = vi.fn()
const clearAuthCookies = vi.fn()
const requireUser = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/auth-cookies', () => ({ clearAuthCookies }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { signOut: signOutMock } }),
}))

const { signOutEverywhere } = await import('./actions')

describe('signOutEverywhere', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: 'u', email: null })
    signOutMock.mockResolvedValue({ error: null })
  })

  it('revokes with the global scope, clears cookies, goes to sign-in', async () => {
    await expect(signOutEverywhere()).rejects.toThrow('redirect:/sign-in')
    expect(signOutMock).toHaveBeenCalledExactlyOnceWith({ scope: 'global' })
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('still clears this browser and flags the failure when revoking fails', async () => {
    signOutMock.mockResolvedValue({ error: new Error('x') })
    await expect(signOutEverywhere()).rejects.toThrow(
      'redirect:/sign-in?error=signout',
    )
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(signOutEverywhere()).rejects.toThrow()
    expect(signOutMock).not.toHaveBeenCalled()
  })
})
