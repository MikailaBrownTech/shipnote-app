import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { NEXT_COOKIE, NEXT_COOKIE_PATH } from '@/lib/next-cookie'
import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/server'

// Built from the configured site URL, never from request headers.
function redirectTo(path: string) {
  const response = NextResponse.redirect(
    new URL(path, env.NEXT_PUBLIC_SITE_URL),
  )
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')

  // The provider sends ?error=... when the user denies access.
  if (searchParams.has('error') || !code) {
    return redirectTo('/sign-in?error=callback')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return redirectTo('/sign-in?error=callback')

  // `next` comes from the URL or from the cookie the server set before a
  // re-sign-in. Either way it goes through safeNext().
  const store = await cookies()
  const next = searchParams.get('next') ?? store.get(NEXT_COOKIE)?.value
  store.delete({ name: NEXT_COOKIE, path: NEXT_COOKIE_PATH })

  return redirectTo(safeNext(next ?? null))
}
