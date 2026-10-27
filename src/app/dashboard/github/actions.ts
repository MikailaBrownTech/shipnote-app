'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { withFlash } from '@/lib/github-flash'
import { projectId } from '@/lib/project-schema'
import { safeNext } from '@/lib/safe-next'
import { githubIsEnabled, installUrl } from '@/server/github-app'
import { disconnectGithub } from '@/server/github-projects'
import { startState } from '@/server/github-state'
import { rateLimit } from '@/server/rate-limit'

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

// "Connect GitHub" and "Reconnect GitHub". Sets the signed state cookie, then
// sends the person to the App's installation page on github.com (the address
// comes from the App slug in the environment, never from the request).
//
// The form may carry the id of the project it was clicked on. Only that id goes
// into the cookie, so the callback can send the person back to it; anything
// that is not a project id is ignored and they come back to the dashboard.
export async function connectGithubAction(form: FormData): Promise<void> {
  const user = await requireUser()
  if (!githubIsEnabled()) notFound()

  const parsed = projectId.safeParse(text(form, 'project'))
  const project = parsed.success ? parsed.data : null
  const origin = project ? `/dashboard/projects/${project}` : '/dashboard'

  if (!(await rateLimit('githubSetup', user.id))) {
    redirect(withFlash(safeNext(origin, '/dashboard'), 'limited'))
  }

  const nonce = await startState(user.id, project)
  const url = installUrl(nonce)
  if (!url) notFound()
  redirect(url)
}

const INSTALLATION_ID = /^\d{1,15}$/

// "Disconnect GitHub" on the dashboard. Removes the connection in Shipnote
// only; it does not uninstall the App on GitHub. Scoped to the user's own
// rows, so another user's installation id removes nothing.
export async function disconnectGithubFromDashboardAction(
  form: FormData,
): Promise<void> {
  const user = await requireUser()
  if (!githubIsEnabled()) notFound()

  const installation = text(form, 'installation')
  if (!INSTALLATION_ID.test(installation)) {
    redirect(withFlash('/dashboard', 'failed'))
  }
  if (!(await rateLimit('githubLink', user.id))) {
    redirect(withFlash('/dashboard', 'limited'))
  }

  const ok = await disconnectGithub(user.id, Number(installation))
  revalidatePath('/dashboard')
  redirect(withFlash('/dashboard', ok ? 'disconnected' : 'failed'))
}
