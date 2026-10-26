'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isInviteRefusal } from '@/lib/auth-errors'
import { env } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'
import { getClientIp } from '@/server/client-ip'
import { allowEmailLink, allowSignInStart } from '@/server/sign-in-limits'

export type SignInState = {
  status: 'idle' | 'sent' | 'invalid' | 'limited' | 'invite' | 'failed'
}

const email = z.email().max(254)
const callbackUrl = `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`

export async function signInWithGitHub(): Promise<SignInState> {
  const ip = await getClientIp()
  if (!(await allowSignInStart(ip))) return { status: 'limited' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: callbackUrl },
  })
  if (error || !data.url) return { status: 'failed' }

  // The provider URL is built by Supabase from the project's own settings.
  redirect(data.url)
}

export async function sendSignInLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = email.safeParse(
    typeof formData.get('email') === 'string'
      ? (formData.get('email') as string).trim()
      : '',
  )
  if (!parsed.success) return { status: 'invalid' }

  const ip = await getClientIp()
  if (!(await allowSignInStart(ip))) return { status: 'limited' }
  if (!(await allowEmailLink(ip, parsed.data))) return { status: 'limited' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: callbackUrl },
  })
  if (isInviteRefusal(error)) return { status: 'invite' }
  if (error) return { status: 'failed' }

  // Same result whether or not the address already has an account.
  return { status: 'sent' }
}
