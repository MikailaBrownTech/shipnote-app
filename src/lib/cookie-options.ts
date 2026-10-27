import type { CookieOptions } from '@supabase/ssr'

// One place for the flags on every cookie this app writes.
//
// - httpOnly: page scripts cannot read the session. Nothing in the app reads
//   it in the browser (there is no browser Supabase client), so nothing needs
//   it to be readable.
// - secure: production only. Browsers refuse Secure cookies on plain http, so
//   development over http://localhost has to leave it off.
// - sameSite lax, path /: the cookie is sent on top-level navigations back to
//   the site (the sign-in redirect) and on every route.
export function sessionCookieOptions(
  production = process.env.NODE_ENV === 'production',
) {
  return {
    path: '/',
    sameSite: 'lax',
    secure: production,
    httpOnly: true,
  } as const satisfies CookieOptions
}

// Applied on top of whatever the Supabase client passes (it carries maxAge
// and, when clearing, maxAge 0), so these four flags cannot be dropped.
export function withSessionCookieOptions(
  options: CookieOptions | undefined,
  production?: boolean,
): CookieOptions {
  return { ...options, ...sessionCookieOptions(production) }
}
