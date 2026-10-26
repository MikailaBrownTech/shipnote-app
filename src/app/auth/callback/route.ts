import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'
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

  return redirectTo(safeNext(searchParams.get('next')))
}
