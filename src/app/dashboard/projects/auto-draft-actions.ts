'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { projectId as projectIdSchema } from '@/lib/project-schema'
import { autoDraftsOn, setAutoDraft } from '@/server/auto-drafts'
import { aiIsEnabled } from '@/server/draft-generation'
import { getProject } from '@/server/projects'
import { rateLimit } from '@/server/rate-limit'

// The per-project switch. Calls requireUser() itself, is a not-found page while
// automatic drafts (or AI) are off, validates its input with Zod, and acts only
// on the signed-in user's own project: someone else's id looks like a missing
// one. Answers are fixed codes. Nothing here logs.

const input = z.strictObject({ on: z.enum(['true', 'false']) })

export type AutoDraftState =
  | { status: 'idle' }
  | { status: 'ok'; on: boolean }
  | { status: 'invalid' | 'limited' | 'no_repo' | 'failed' }

// Used with useActionState: (project id, previous state, form).
export async function setAutoDraftAction(
  id: string,
  _previous: AutoDraftState,
  form: FormData,
): Promise<AutoDraftState> {
  const user = await requireUser()
  if (!autoDraftsOn() || !aiIsEnabled()) notFound()
  if (!projectIdSchema.safeParse(id).success) notFound()

  const parsed = input.safeParse({ on: form.get('on') })
  if (!parsed.success) return { status: 'invalid' }
  const on = parsed.data.on === 'true'
  if (!(await rateLimit('draftEdit', user.id))) return { status: 'limited' }

  const project = await getProject(user.id, id)
  if (!project.ok) {
    if (project.reason === 'not_found') notFound()
    return { status: 'failed' }
  }
  // It needs a linked repository that Shipnote can still reach.
  if (
    on &&
    (!project.value.repoFullName || project.value.installationId === null)
  ) {
    return { status: 'no_repo' }
  }

  const result = await setAutoDraft(user.id, id, on)
  if (result === 'not_found') notFound()
  if (result === 'failed') return { status: 'failed' }
  revalidatePath(`/dashboard/projects/${id}`)
  return { status: 'ok', on }
}
