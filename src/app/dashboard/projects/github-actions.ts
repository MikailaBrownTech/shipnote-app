'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { withFlash, type GithubFlash } from '@/lib/github-flash'
import { projectId } from '@/lib/project-schema'
import { githubIsEnabled } from '@/server/github-app'
import {
  checkPostCommits,
  disconnectGithub,
  linkRepo,
  unlinkRepo,
  type CommitCheck,
} from '@/server/github-projects'
import { rateLimit } from '@/server/rate-limit'

// Every action here calls requireUser() itself, 404s while the feature is off,
// validates the project id as a UUID, and acts only on the signed-in user's own
// project: a missing id and someone else's id look the same.

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

async function start(id: string) {
  const user = await requireUser()
  if (!githubIsEnabled()) notFound()
  if (!projectId.safeParse(id).success) notFound()
  return user
}

const projectPath = (id: string) => `/dashboard/projects/${id}`

function done(id: string, flash: GithubFlash): never {
  revalidatePath(projectPath(id))
  redirect(withFlash(projectPath(id), flash))
}

const INSTALLATION_ID = /^\d{1,15}$/

// The picker sends "<installation id>|<owner/repo>". Both parts are checked
// again on the server; the repository must also be on the installation's list.
function parseChoice(
  value: string,
): { installationId: number; repoFullName: string } | null {
  const at = value.indexOf('|')
  if (at < 1) return null
  const id = value.slice(0, at)
  if (!INSTALLATION_ID.test(id)) return null
  return { installationId: Number(id), repoFullName: value.slice(at + 1) }
}

export async function linkRepoAction(
  id: string,
  form: FormData,
): Promise<void> {
  const user = await start(id)
  const choice = parseChoice(text(form, 'choice'))
  if (!choice) done(id, 'repo')
  if (!(await rateLimit('githubLink', user.id))) done(id, 'limited')

  const result = await linkRepo({
    userId: user.id,
    projectId: id,
    ...choice,
  })
  if (result === 'not_found') notFound()
  if (result === 'linked') done(id, 'linked')
  if (result === 'not_in_list' || result === 'no_installation') {
    done(id, 'repo')
  }
  if (result === 'rate_limited' || result === 'unavailable') {
    done(id, 'unavailable')
  }
  done(id, 'failed')
}

export async function unlinkRepoAction(id: string): Promise<void> {
  const user = await start(id)
  const result = await unlinkRepo(user.id, id)
  if (result === 'not_found') notFound()
  done(id, result === 'unlinked' ? 'unlinked' : 'failed')
}

// Removes the connection in Shipnote. It does not uninstall the App on GitHub.
export async function disconnectGithubAction(
  id: string,
  form: FormData,
): Promise<void> {
  const user = await start(id)
  const installation = text(form, 'installation')
  if (!INSTALLATION_ID.test(installation)) done(id, 'failed')
  if (!(await rateLimit('githubLink', user.id))) done(id, 'limited')
  // Scoped to the user's own rows, so another user's id removes nothing.
  const ok = await disconnectGithub(user.id, Number(installation))
  done(id, ok ? 'disconnected' : 'failed')
}

export type CommitState =
  { status: 'idle' } | { status: 'limited' } | CommitCheck

// Used with useActionState, which also passes the previous state and the form;
// neither is needed.
export async function checkCommitsAction(id: string): Promise<CommitState> {
  const user = await start(id)
  if (!(await rateLimit('githubCommits', user.id))) {
    return { status: 'limited' }
  }
  const result = await checkPostCommits(user.id, id)
  if (result.status === 'not_found') notFound()
  // The installation may have been forgotten, which changes what the page
  // shows (a "Reconnect GitHub" button), so refresh it.
  if (result.status === 'reconnect') revalidatePath(projectPath(id))
  return result
}
