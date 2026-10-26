import { beforeEach, describe, expect, it, vi } from 'vitest'

const signInWithOtp = vi.fn()
const signInWithOAuth = vi.fn()
const getClientIp = vi.fn()
const allowSignInStart = vi.fn()
const allowEmailLink = vi.fn()
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://shipnote.test' },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({ auth: { signInWithOtp, signInWithOAuth } }),
}))
vi.mock('@/server/client-ip', () => ({ getClientIp }))
vi.mock('@/server/sign-in-limits', () => ({ allowSignInStart, allowEmailLink }))

const { sendSignInLink, signInWithGitHub } = await import('./actions')

function form(email: string) {
  const data = new FormData()
  data.set('email', email)
  return data
}

describe('sign-in actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getClientIp.mockResolvedValue('203.0.113.7')
    allowSignInStart.mockResolvedValue(true)
    allowEmailLink.mockResolvedValue(true)
    signInWithOtp.mockResolvedValue({ error: null })
    signInWithOAuth.mockResolvedValue({
      data: { url: 'https://github.test/login' },
      error: null,
    })
  })

  it('sends a link and answers the same way for any address', async () => {
    const result = await sendSignInLink({ status: 'idle' }, form(' A@b.co '))
    expect(result).toEqual({ status: 'sent' })
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'A@b.co',
      options: { emailRedirectTo: 'https://shipnote.test/auth/callback' },
    })
  })

  it('rejects a malformed address before touching anything', async () => {
    const result = await sendSignInLink({ status: 'idle' }, form('nope'))
    expect(result).toEqual({ status: 'invalid' })
    expect(allowEmailLink).not.toHaveBeenCalled()
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('does not call Supabase once the email-link limit is hit', async () => {
    allowEmailLink.mockResolvedValue(false)
    const result = await sendSignInLink({ status: 'idle' }, form('a@b.co'))
    expect(result).toEqual({ status: 'limited' })
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('does not call Supabase once the sign-in-start limit is hit', async () => {
    allowSignInStart.mockResolvedValue(false)
    expect(await signInWithGitHub()).toEqual({ status: 'limited' })
    expect(signInWithOAuth).not.toHaveBeenCalled()
  })

  it('shows the invite-only message when sign-up is refused', async () => {
    signInWithOtp.mockResolvedValue({
      error: { message: 'Sign-up is invite only' },
    })
    const result = await sendSignInLink({ status: 'idle' }, form('a@b.co'))
    expect(result).toEqual({ status: 'invite' })
  })

  it('redirects to the provider URL for GitHub', async () => {
    await expect(signInWithGitHub()).rejects.toThrow(
      'redirect:https://github.test/login',
    )
  })
})
