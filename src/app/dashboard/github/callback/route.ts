import { connection, NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { withFlash, type GithubFlash } from '@/lib/github-flash'
import { env } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { getProject } from '@/server/projects'
import { githubIsEnabled, saveVerifiedInstallation } from '@/server/github-app'
import { verifyInstallation, type VerifyFailure } from '@/server/github-connect'
import { consumeState } from '@/server/github-state'
import { rateLimit } from '@/server/rate-limit'

// The GitHub App's Callback URL. With "Request user authorization during
// installation" on, GitHub sends the person here after they install the App,
// with a one-time `code` (and, in practice, an `installation_id`).
//
// Nothing in the URL is trusted. The signed-in user comes from the session, the
// connect attempt from a signed cookie this server set, and installation
// ownership from GitHub itself (see verifyInstallation).

const CODE = /^[A-Za-z0-9_-]{8,200}$/
const INSTALLATION_ID = /^\d{1,15}$/

const failureFlash: Record<VerifyFailure, GithubFlash> = {
  invalid: 'invalid',
  denied: 'denied',
  org: 'org',
  unavailable: 'unavailable',
  rate_limited: 'unavailable',
  failed: 'failed',
}

// Built from the configured site URL, never from request headers. The path
// goes through safeNext(). Failures always land on the dashboard; success on
// the dashboard or the project the person started from.
function back(path: string, flash: GithubFlash) {
  const target = safeNext(path, '/dashboard')
  const response = NextResponse.redirect(
    new URL(withFlash(target, flash), env.NEXT_PUBLIC_SITE_URL),
  )
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: NextRequest) {
  // Always a per-request response. Without this, a build with the feature off
  // could prerender the 404 below as a static file.
  await connection()

  if (!githubIsEnabled()) return new NextResponse(null, { status: 404 })

  const user = await requireUser()
  if (!(await rateLimit('githubSetup', user.id))) {
    return back('/dashboard', 'limited')
  }

  const { searchParams } = request.nextUrl

  // The cookie is read once and cleared whatever happens.
  const state = await consumeState({
    userId: user.id,
    returnedState: searchParams.get('state'),
  })
  if (!state.ok) return back('/dashboard', 'expired')

  const code = searchParams.get('code')
  if (!code || !CODE.test(code)) return back('/dashboard', 'invalid')

  const claimed = searchParams.get('installation_id')
  if (claimed !== null && !INSTALLATION_ID.test(claimed)) {
    return back('/dashboard', 'invalid')
  }

  const verified = await verifyInstallation({
    code,
    claimedInstallationId: claimed === null ? null : Number(claimed),
  })
  if (!verified.ok) return back('/dashboard', failureFlash[verified.reason])

  // The user id is the signed-in user's, from the session.
  const saved = await saveVerifiedInstallation({
    userId: user.id,
    ...verified.installation,
  })
  if (saved === 'taken') return back('/dashboard', 'taken')
  if (saved === 'failed') return back('/dashboard', 'failed')

  // Success goes back to the project the person started from, if there was one
  // and it is still theirs. The cookie held only an id; the path is built here.
  if (state.projectId) {
    const own = await getProject(user.id, state.projectId)
    if (own.ok) return back(`/dashboard/projects/${own.value.id}`, 'connected')
  }
  return back('/dashboard', 'connected')
}
