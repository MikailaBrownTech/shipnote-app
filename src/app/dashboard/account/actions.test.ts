import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOutMock = vi.fn()
const clearAuthCookies = vi.fn()
const requireUser = vi.fn()
const deleteAccount = vi.fn()
const rememberNext = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/auth-cookies', () => ({ clearAuthCookies }))
vi.mock('@/lib/next-cookie', () => ({ rememberNext }))
vi.mock('@/server/delete-account', () => ({ deleteAccount }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { signOut: signOutMock } }),
}))

const { deleteAccountAction } = await import('./actions')

const form = (confirm: string) => {
  const data = new FormData()
  data.set('confirm', confirm)
  return data
}

describe('deleteAccountAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: 'u', email: 'a@b.co', signedInAt: 1 })
    signOutMock.mockResolvedValue({ error: null })
  })

  it('on success signs out everywhere, clears cookies and shows the deleted page', async () => {
    deleteAccount.mockResolvedValue('deleted')
    await expect(
      deleteAccountAction({ error: null }, form('a@b.co')),
    ).rejects.toThrow('redirect:/account-deleted')
    expect(deleteAccount).toHaveBeenCalledOnce()
    expect(signOutMock).toHaveBeenCalledExactlyOnceWith({ scope: 'global' })
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('still clears cookies and redirects if the revoke call throws', async () => {
    deleteAccount.mockResolvedValue('deleted')
    signOutMock.mockRejectedValue(new Error('session gone'))
    await expect(
      deleteAccountAction({ error: null }, form('a@b.co')),
    ).rejects.toThrow('redirect:/account-deleted')
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it.each(['confirm', 'limited', 'failed'] as const)(
    'returns %s without signing anyone out',
    async (outcome) => {
      deleteAccount.mockResolvedValue(outcome)
      expect(await deleteAccountAction({ error: null }, form('x'))).toEqual({
        error: outcome,
      })
      expect(signOutMock).not.toHaveBeenCalled()
      expect(clearAuthCookies).not.toHaveBeenCalled()
    },
  )

  it('sends a stale sign-in through sign-in and back', async () => {
    deleteAccount.mockResolvedValue('recent')
    await expect(
      deleteAccountAction({ error: null }, form('a@b.co')),
    ).rejects.toThrow('redirect:/sign-in?reauth=1')
    expect(rememberNext).toHaveBeenCalledWith('/dashboard/account')
    expect(signOutMock).not.toHaveBeenCalled()
  })
})
