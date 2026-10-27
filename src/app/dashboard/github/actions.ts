'use server'

import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { withFlash } from '@/lib/github-flash'
import { safeNext } from '@/lib/safe-next'
import { githubIsEnabled, installUrl } from '@/server/github-app'
import { startState } from '@/server/github-state'
import { rateLimit } from '@/server/rate-limit'

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

// Where to come back to: a path inside the dashboard, nothing else.
function dashboardPath(value: string) {
  const path = safeNext(value, '/dashboard')
  return path === '/dashboard' || path.startsWith('/dashboard/')
    ? path
    : '/dashboard'
}

// "Connect GitHub" and "Reconnect GitHub". Sets the signed state cookie, then
// sends the person to the App's installation page on github.com (the address
// comes from the App slug in the environment, never from the request).
export async function connectGithubAction(form: FormData): Promise<void> {
  const user = await requireUser()
  if (!githubIsEnabled()) notFound()

  const next = dashboardPath(text(form, 'next'))
  if (!(await rateLimit('githubSetup', user.id))) {
    redirect(withFlash(next, 'limited'))
  }

  const nonce = await startState(user.id, next)
  const url = installUrl(nonce)
  if (!url) notFound()
  redirect(url)
}
