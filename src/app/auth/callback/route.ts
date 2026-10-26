import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { callbackErrorCode, type SignInError } from '@/lib/auth-errors'
import { clearAuthCookies } from '@/lib/auth-cookies'
import { env } from '@/lib/env'
import { checkGithubSignIn } from '@/lib/github-verified'
import { NEXT_COOKIE, NEXT_COOKIE_PATH } from '@/lib/next-cookie'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/server'
import { removeUnverifiedAccount } from '@/server/remove-account'

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

  // `next` comes from the URL or from the cookie the server set before a
  // re-sign-in. Either way it goes through safeNext().
  const store = await cookies()
  const next = searchParams.get('next') ?? store.get(NEXT_COOKIE)?.value
  store.delete({ name: NEXT_COOKIE, path: NEXT_COOKIE_PATH })

  return redirectTo(safeNext(next ?? null))
}
