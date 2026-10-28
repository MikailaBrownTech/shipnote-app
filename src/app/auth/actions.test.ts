import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOutMock = vi.fn()
const clearAuthCookies = vi.fn()
const requireUser = vi.fn()
const remainingSessions = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/session-check', () => ({ remainingSessions }))
vi.mock('@/lib/auth-cookies', () => ({ clearAuthCookies }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { signOut: signOutMock } }),
}))

const { signOut, signOutEverywhere } = await import('./actions')

describe('signOut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signOutMock.mockResolvedValue({ error: null })
  })

  it('signs out this browser only (local scope), clears the cookies and goes home', async () => {
    await expect(signOut()).rejects.toThrow('redirect:/')
    expect(signOutMock).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    expect(clearAuthCookies).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/')
  })

  it('never signs the person out of their other devices', async () => {
    await expect(signOut()).rejects.toThrow()
    expect(signOutMock).not.toHaveBeenCalledWith({ scope: 'global' })
    expect(remainingSessions).not.toHaveBeenCalled()
  })

  it('does not need a signed-in user: signing out is always allowed', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(signOut()).rejects.toThrow('redirect:/')
    expect(requireUser).not.toHaveBeenCalled()
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('still clears the cookies and goes home when Supabase returns an error', async () => {
    signOutMock.mockResolvedValue({ error: new Error('x') })
    await expect(signOut()).rejects.toThrow('redirect:/')
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('still clears the cookies and goes home when Supabase throws or cannot be reached', async () => {
    signOutMock.mockRejectedValue(new TypeError('network down'))
    await expect(signOut()).rejects.toThrow('redirect:/')
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('says nothing about the error: nothing is logged', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    signOutMock.mockRejectedValue(new Error('token abc123'))
    await expect(signOut()).rejects.toThrow()
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(
      'abc123',
    )
  })
})

describe('signOutEverywhere', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: 'u', email: null })
    remainingSessions.mockResolvedValue(0)
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

  it('reports a failure when sessions remain, even if the library said success', async () => {
    // The library treats a refused logout (401/403/404) as success.
    remainingSessions.mockResolvedValue(2)
    await expect(signOutEverywhere()).rejects.toThrow(
      'redirect:/sign-in?error=signout',
    )
    expect(clearAuthCookies).toHaveBeenCalledOnce()
  })

  it('reports a failure when the remaining count cannot be read', async () => {
    remainingSessions.mockResolvedValue(null)
    await expect(signOutEverywhere()).rejects.toThrow(
      'redirect:/sign-in?error=signout',
    )
  })

  it('revokes before it clears the cookies', async () => {
    const order: string[] = []
    signOutMock.mockImplementation(() => {
      order.push('revoke')
      return Promise.resolve({ error: null })
    })
    clearAuthCookies.mockImplementation(() => {
      order.push('clear')
      return Promise.resolve()
    })
    await expect(signOutEverywhere()).rejects.toThrow()
    expect(order).toEqual(['revoke', 'clear'])
  })

  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(signOutEverywhere()).rejects.toThrow()
    expect(signOutMock).not.toHaveBeenCalled()
  })
})
