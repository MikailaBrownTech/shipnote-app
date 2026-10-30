import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // Skip static files, the health check, and the webhook and queue endpoints that later
    // sprints add, which authenticate themselves and must not touch cookies.
    '/((?!_next/static|_next/image|favicon\.ico|api/webhooks(?:/|$)|api/queue(?:/|$)|api/health(?:/|$)|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|css|js|map|txt|xml)$).*)',
  ],
}
