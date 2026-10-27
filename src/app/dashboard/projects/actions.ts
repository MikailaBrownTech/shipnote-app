'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { isRepoFullName } from '@/lib/github-repo'
import {
  parseProjectForm,
  projectId,
  type FieldErrors,
} from '@/lib/project-schema'
import { githubIsEnabled } from '@/server/github-app'
import { linkCreatedProject, verifyRepoForLink } from '@/server/github-import'
import { createProject, deleteProject, updateProject } from '@/server/projects'
import { rateLimit } from '@/server/rate-limit'

// What the form shows back after a problem, so a typo does not wipe the notes.
export type FormValues = {
  name: string
  summary: string
  stage: string
  notes: string
}

export type ProjectFormState = {
  status:
    | 'idle'
    | 'invalid'
    | 'limited'
    | 'limit'
    | 'failed'
    // Starting from a GitHub repo: the repo cannot be used, is already linked
    // to another project, or GitHub could not be reached.
    | 'repo'
    | 'repo_taken'
    | 'repo_unavailable'
  errors: FieldErrors
  values: FormValues | null
}

export type DeleteProjectState = { status: 'idle' | 'failed' }

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function back(
  status: ProjectFormState['status'],
  form: FormData,
  errors: FieldErrors = {},
): ProjectFormState {
  return {
    status,
    errors,
    values: {
      name: text(form, 'name'),
      summary: text(form, 'summary'),
      stage: text(form, 'stage'),
      notes: text(form, 'notes'),
    },
  }
}

// The new-project form can carry a GitHub repository (started from "Start from a
// GitHub repo"). These two hidden fields are the only extra fields it may have,
// and they are never trusted: the repository is checked against the
// installation's list again before anything is saved.
const LINK_INSTALLATION_FIELD = 'github_installation'
const LINK_REPO_FIELD = 'github_repo'

type Link = { installationId: number; repoFullName: string }

// null: no repository on this form. 'bad': one is there but malformed.
function readLink(form: FormData): Link | null | 'bad' {
  const installation = text(form, LINK_INSTALLATION_FIELD)
  const repo = text(form, LINK_REPO_FIELD)
  if (installation === '' && repo === '') return null
  if (!/^\d{1,15}$/.test(installation) || !isRepoFullName(repo)) return 'bad'
  return { installationId: Number(installation), repoFullName: repo }
}

// The form without the link fields, for the strict project schema.
function withoutLink(form: FormData): FormData {
  const clean = new FormData()
  for (const [key, value] of form.entries()) {
    if (key === LINK_INSTALLATION_FIELD || key === LINK_REPO_FIELD) continue
    clean.append(key, value)
  }
  return clean
}

// Every action calls requireUser() itself. Row-level security is the backstop,
// not the check.
export async function createProjectAction(
  _previous: ProjectFormState,
  form: FormData,
): Promise<ProjectFormState> {
  const user = await requireUser()
  if (!(await rateLimit('projectCreate', user.id))) return back('limited', form)

  const link = readLink(form)
  if (link === 'bad') return back('repo', form)

  const parsed = parseProjectForm(withoutLink(form))
  if (!parsed.ok) return back('invalid', form, parsed.errors)

  // Confirm the repository before creating anything.
  let verified: Link | null = null
  if (link) {
    if (!githubIsEnabled()) return back('repo', form)
    if (!(await rateLimit('githubLink', user.id))) return back('limited', form)
    const check = await verifyRepoForLink({ userId: user.id, ...link })
    if (check.status !== 'ok') {
      if (check.status === 'already_linked') return back('repo_taken', form)
      if (check.status === 'rate_limited' || check.status === 'unavailable') {
        return back('repo_unavailable', form)
      }
      if (check.status === 'failed') return back('failed', form)
      return back('repo', form)
    }
    verified = {
      installationId: check.installationId,
      repoFullName: check.repoFullName,
    }
  }

  const result = await createProject(user.id, parsed.data)
  if (!result.ok) {
    return back(result.reason === 'limit' ? 'limit' : 'failed', form)
  }

  revalidatePath('/dashboard')
  const path = `/dashboard/projects/${result.value.id}`
  if (!verified) redirect(path)

  // The project exists now. If linking fails, it still does, unlinked.
  const linked = await linkCreatedProject({
    userId: user.id,
    projectId: result.value.id,
    ...verified,
  })
  redirect(`${path}?github=${linked ? 'linked' : 'linkfailed'}`)
}

// Bound to the project id when the form is built: updateProjectAction.bind(null, id).
export async function updateProjectAction(
  id: string,
  _previous: ProjectFormState,
  form: FormData,
): Promise<ProjectFormState> {
  const user = await requireUser()
  if (!projectId.safeParse(id).success) notFound()
  if (!(await rateLimit('projectUpdate', user.id))) return back('limited', form)

  const parsed = parseProjectForm(form)
  if (!parsed.ok) return back('invalid', form, parsed.errors)

  const result = await updateProject(user.id, id, parsed.data)
  // A missing id and someone else's id look the same.
  if (!result.ok && result.reason === 'not_found') notFound()
  if (!result.ok) return back('failed', form)

  revalidatePath('/dashboard')
  redirect(`/dashboard/projects/${result.value.id}`)
}

export async function deleteProjectAction(
  id: string,
  _previous: DeleteProjectState,
  form: FormData,
): Promise<DeleteProjectState> {
  const user = await requireUser()
  if (!projectId.safeParse(id).success) notFound()
  // The confirmation step sends this; a bare request does not delete.
  if (text(form, 'confirm') !== 'yes') return { status: 'failed' }

  const result = await deleteProject(user.id, id)
  if (!result.ok && result.reason === 'not_found') notFound()
  if (!result.ok) return { status: 'failed' }

  revalidatePath('/dashboard')
  redirect('/dashboard')
}
