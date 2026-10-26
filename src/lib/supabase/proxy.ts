import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'

// Refreshes the session and returns the response that carries the new
// cookies. Redirects /dashboard to /sign-in when there is no valid session.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  // Cache headers the Supabase client asks for whenever it sets auth cookies,
  // so no CDN can serve one user's session to another.
  let cacheHeaders: Record<string, string> = {}

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
          cacheHeaders = { ...cacheHeaders, ...headers }
          Object.entries(cacheHeaders).forEach(([key, value]) =>
            response.headers.set(key, value),
          )
        },
      },
    },
  )

  // Verifies the signed token. Do not run code between creating the client
  // and this call, and never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  if (!signedIn && request.nextUrl.pathname.startsWith('/dashboard')) {
    const redirect = NextResponse.redirect(
      new URL('/sign-in', env.NEXT_PUBLIC_SITE_URL),
    )
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    Object.entries(cacheHeaders).forEach(([key, value]) =>
      redirect.headers.set(key, value),
    )
    return redirect
  }

  return response
}
