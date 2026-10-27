import { connection, NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { withBufferFlash, type BufferFlash } from '@/lib/buffer-flash'
import { env } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { consumeState } from '@/server/buffer-state'
import { getProject } from '@/server/projects'
import { rateLimit } from '@/server/rate-limit'
import {
  completeConnect,
  schedulingIsEnabled,
  type ConnectResult,
} from '@/server/scheduling'

// The Buffer App Client's redirect URI: /dashboard/buffer/callback. Buffer sends
// the person here after they allow access, with a one-time `code` and the
// `state` this server set.
//
// Nothing in the URL is trusted. The signed-in user comes from the session; the
// connect attempt from a sealed cookie this server set (single use, bound to the
// user, ten minutes); the `state` must match the one inside it; the tokens are
// exchanged with the PKCE verifier kept in that cookie. A failure stores
// nothing.

const CODE = /^[A-Za-z0-9._~+/=-]{8,2048}$/

const resultFlash: Record<ConnectResult, BufferFlash> = {
  connected: 'connected',
  denied: 'denied',
  no_organization: 'no_organization',
  rate_limited: 'rate_limited',
  unavailable: 'unavailable',
  failed: 'failed',
}

// Built from the configured site URL, never from request headers, and always
// through safeNext().
function back(path: string, flash: BufferFlash) {
  const target = safeNext(path, '/dashboard')
  const response = NextResponse.redirect(
    new URL(withBufferFlash(target, flash), env.NEXT_PUBLIC_SITE_URL),
  )
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: NextRequest) {
  // Always a per-request response, so a build with the feature off cannot
  // prerender the 404 below as a static file.
  await connection()

  if (!schedulingIsEnabled()) return new NextResponse(null, { status: 404 })

  const user = await requireUser()
  if (!(await rateLimit('bufferConnect', user.id))) {
    return back('/dashboard', 'limited')
  }

  const { searchParams } = request.nextUrl

  // The cookie is read once and cleared whatever happens, so a replay fails.
  const state = await consumeState({
    userId: user.id,
    returnedState: searchParams.get('state'),
  })
  if (!state.ok) return back('/dashboard', 'expired')

  // The person said no, or Buffer refused.
  if (searchParams.has('error')) return back('/dashboard', 'denied')

  const code = searchParams.get('code')
  if (!code || !CODE.test(code)) return back('/dashboard', 'failed')

  const result = await completeConnect({
    userId: user.id,
    code,
    verifier: state.verifier,
  })

  // Success goes back to the project (and draft) the person started from, if
  // they are still theirs. The cookie held only ids; the path is built here, and
  // only the project id is used in it.
  if (result === 'connected' && state.returnTo) {
    const own = await getProject(user.id, state.returnTo.projectId)
    if (own.ok) {
      return back(`/dashboard/projects/${own.value.id}?tab=drafts`, 'connected')
    }
  }
  return back('/dashboard', resultFlash[result])
}
