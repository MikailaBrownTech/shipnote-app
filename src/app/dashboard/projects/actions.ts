'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import {
  parseProjectForm,
  projectId,
  type FieldErrors,
} from '@/lib/project-schema'
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
  status: 'idle' | 'invalid' | 'limited' | 'limit' | 'failed'
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

// Every action calls requireUser() itself. Row-level security is the backstop,
// not the check.
export async function createProjectAction(
  _previous: ProjectFormState,
  form: FormData,
): Promise<ProjectFormState> {
  const user = await requireUser()
  if (!(await rateLimit('projectCreate', user.id))) return back('limited', form)

  const parsed = parseProjectForm(form)
  if (!parsed.ok) return back('invalid', form, parsed.errors)

  const result = await createProject(user.id, parsed.data)
  if (!result.ok) {
    return back(result.reason === 'limit' ? 'limit' : 'failed', form)
  }

  revalidatePath('/dashboard')
  redirect(`/dashboard/projects/${result.value.id}`)
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
