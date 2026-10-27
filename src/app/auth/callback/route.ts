import { cookies } from 'next/headers'
import { after, NextResponse, type NextRequest } from 'next/server'
import { callbackErrorCode, type SignInError } from '@/lib/auth-errors'
import { clearAuthCookies } from '@/lib/auth-cookies'
import { env } from '@/lib/env'
import { checkGithubSignIn } from '@/lib/github-verified'
import { NEXT_COOKIE, nextCookieOptions } from '@/lib/next-cookie'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/server'
import { getClientIp } from '@/server/client-ip'
import { removeUnverifiedAccount } from '@/server/remove-account'
import { recordSignInAndAlert } from '@/server/sign-in-alert'

// Built from the configured site URL, never from request headers.
function redirectTo(path: string) {
  const response = NextResponse.redirect(
    new URL(path, env.NEXT_PUBLIC_SITE_URL),
  )
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function fail(code: SignInError) {
  return redirectTo(`/sign-in?error=${code}`)
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')

  // Supabase or the provider sends ?error=... when sign-in did not finish:
  // an uninvited sign-up, an expired link, or access denied at GitHub.
  if (searchParams.has('error')) return fail(callbackErrorCode(searchParams))
  if (!code) return fail('failed')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return fail('expired')

  // Backstop for the before-user-created hook, which is the real gate: if a
  // GitHub sign-in cannot show a verified email, sign out and, for an account
  // created a moment ago, remove it.
  const check = checkGithubSignIn(data.user, Date.now())
  if (check === 'deny' || check === 'deny-and-delete') {
    if (check === 'deny-and-delete') await removeUnverifiedAccount(data.user.id)
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    await clearAuthCookies()
    return fail('invite')
  }

  // Record the sign-in and, for a new device, send an alert. This runs after
  // the response, so it never slows or blocks sign-in. Everything it needs is
  // read now, because request APIs are not available later.
  const info = {
    userId: data.user.id,
    email: data.user.email ?? null,
    method: check === 'ok' ? ('github' as const) : ('email' as const),
    userAgent: request.headers.get('user-agent'),
    ip: await getClientIp(),
  }
  after(() => recordSignInAndAlert(info))

  // `next` comes from the URL or from the cookie the server set before a
  // re-sign-in. Either way it goes through safeNext().
  const store = await cookies()
  const next = searchParams.get('next') ?? store.get(NEXT_COOKIE)?.value
  store.set(NEXT_COOKIE, '', {
    ...nextCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  })

  return redirectTo(safeNext(next ?? null))
}
