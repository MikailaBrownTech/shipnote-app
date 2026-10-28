'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { withBufferFlash, type BufferFlash } from '@/lib/buffer-flash'
import { checkDraft, type DraftWarning } from '@/lib/draft-checker'
import { projectId as projectIdSchema } from '@/lib/project-schema'
import { safeNext } from '@/lib/safe-next'
import {
  beginConnect,
  bodyHash,
  cancelSchedule,
  channelsFor,
  disconnectBuffer,
  refreshStatuses,
  scheduleDraft,
  schedulingIsEnabled,
  type CancelResult,
  type ScheduleFailure,
} from '@/server/scheduling'
import { getDraft } from '@/server/drafts'
import { getProject } from '@/server/projects'
import { rateLimit } from '@/server/rate-limit'
import { getScheduledPost } from '@/server/scheduled-posts'
import { secretProblem } from '@/lib/secret-scan'

// Every action here calls requireUser() itself, answers with a not-found page
// while SCHEDULING_ENABLED is off (the kill switch), checks its input with Zod,
// and acts only on the signed-in user's own records: a missing id and someone
// else's id look the same. Results are fixed codes, never text from Buffer.
// Nothing here logs. Nothing is scheduled except by scheduleDraftAction, which
// needs the hash of the text the person reviewed.

const uuid = z.uuid()

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

async function start() {
  const user = await requireUser()
  if (!schedulingIsEnabled()) notFound()
  return user
}

const projectPath = (id: string) => `/dashboard/projects/${id}?tab=drafts`

// ---- Connect and disconnect ----

// "Connect Buffer". The form may carry the project and draft it was clicked
// on; they are kept only if they are the person's own, so the callback can send
// them back there. Anything else goes back to the dashboard.
export async function connectBufferAction(form: FormData): Promise<void> {
  const user = await start()

  let returnTo: { projectId: string; draftId: string | null } | null = null
  const project = projectIdSchema.safeParse(text(form, 'project'))
  if (project.success) {
    const own = await getProject(user.id, project.data)
    if (own.ok) {
      const draft = uuid.safeParse(text(form, 'draft'))
      let draftId: string | null = null
      if (draft.success) {
        const found = await getDraft(user.id, draft.data)
        if (found !== 'not_found' && found !== 'failed') {
          draftId = found.projectId === own.value.id ? found.id : null
        }
      }
      returnTo = { projectId: own.value.id, draftId }
    }
  }
  const origin = returnTo ? projectPath(returnTo.projectId) : '/dashboard'

  if (!(await rateLimit('bufferConnect', user.id))) {
    redirect(withBufferFlash(safeNext(origin, '/dashboard'), 'limited'))
  }

  const url = await beginConnect(user.id, returnTo)
  if (!url) notFound()
  redirect(url)
}

// "Disconnect Buffer". Deletes Shipnote's copy of the tokens. Buffer has no
// revoke call, so the flash message says the person must also remove Shipnote in
// Buffer. With "cancel first" ticked, scheduled posts are cancelled at Buffer
// before the tokens go.
export async function disconnectBufferAction(form: FormData): Promise<void> {
  const user = await start()
  if (!(await rateLimit('bufferConnect', user.id))) {
    redirect(withBufferFlash('/dashboard', 'limited'))
  }
  const cancelFirst = form.get('cancel_first') === 'on'
  const result = await disconnectBuffer({ userId: user.id, cancelFirst })
  revalidatePath('/dashboard')
  const flash: BufferFlash = !result.ok
    ? 'failed'
    : result.couldNotCancel > 0
      ? 'disconnected_posts'
      : 'disconnected'
  redirect(withBufferFlash('/dashboard', flash))
}

// ---- The review step ----

export type ReviewState =
  | {
      status: 'ok'
      draftId: string
      text: string
      hash: string
      warnings: DraftWarning[]
      channels: { id: string; label: string }[]
    }
  // The saved text looks like it holds a key or a token: nothing was read from
  // Buffer and nothing can be scheduled until it is removed.
  | { status: 'secret'; message: string }
  | {
      status:
        | 'not_found'
        | 'limited'
        | 'needs_reconnect'
        | 'rate_limited'
        | 'unavailable'
        | 'no_channels'
        | 'failed'
    }

// Opens the review: reads the saved text, its hash and the person's LinkedIn
// channels from Buffer. Nothing is scheduled.
export async function startReviewAction(
  projectIdValue: string,
  draftIdValue: string,
): Promise<ReviewState> {
  const user = await start()
  if (!projectIdSchema.safeParse(projectIdValue).success) notFound()
  if (!uuid.safeParse(draftIdValue).success) return { status: 'not_found' }
  if (!(await rateLimit('bufferSchedule', user.id))) {
    return { status: 'limited' }
  }

  const project = await getProject(user.id, projectIdValue)
  if (!project.ok) {
    return project.reason === 'not_found'
      ? { status: 'not_found' }
      : { status: 'failed' }
  }
  const draft = await getDraft(user.id, draftIdValue)
  if (draft === 'not_found') return { status: 'not_found' }
  if (draft === 'failed' || draft.projectId !== project.value.id) {
    return { status: draft === 'failed' ? 'failed' : 'not_found' }
  }

  // Before anything is asked of Buffer.
  const problem = secretProblem(draft.body, 'the draft', 'open the review')
  if (problem !== null) return { status: 'secret', message: problem }

  const channels = await channelsFor(user.id)
  if (!channels.ok) return { status: channels.reason }
  if (channels.channels.length === 0) return { status: 'no_channels' }

  return {
    status: 'ok',
    draftId: draft.id,
    text: draft.body,
    hash: bodyHash(draft.body),
    warnings: checkDraft({
      body: draft.body,
      stage: project.value.stage,
      inputText: null,
    }),
    channels: channels.channels,
  }
}

// ---- Confirm ----

const confirmInput = z.strictObject({
  channelId: z.string().min(1).max(200),
  local: z.string().max(20),
  timeZone: z.string().max(64),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
})

export type ConfirmState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'limited' }
  | { status: 'scheduled'; id: string; scheduledFor: string }
  | { status: 'refused'; reason: ScheduleFailure }

// The explicit Confirm click. Used with useActionState: (project id, draft id,
// previous state, form). The time arrives as the person's local wall-clock time
// and zone, and is converted on the server.
export async function confirmScheduleAction(
  projectIdValue: string,
  draftIdValue: string,
  _previous: ConfirmState,
  form: FormData,
): Promise<ConfirmState> {
  const user = await start()
  if (!projectIdSchema.safeParse(projectIdValue).success) notFound()
  if (!uuid.safeParse(draftIdValue).success) {
    return { status: 'refused', reason: 'not_found' }
  }
  const parsed = confirmInput.safeParse({
    channelId: text(form, 'channel'),
    local: text(form, 'local'),
    timeZone: text(form, 'timezone'),
    hash: text(form, 'hash'),
  })
  if (!parsed.success) return { status: 'invalid' }
  if (!(await rateLimit('bufferSchedule', user.id))) {
    return { status: 'limited' }
  }

  // The draft must be one of this project's, and the project the person's.
  const project = await getProject(user.id, projectIdValue)
  if (!project.ok) {
    if (project.reason === 'not_found') notFound()
    return { status: 'refused', reason: 'failed' }
  }

  const result = await scheduleDraft({
    userId: user.id,
    draftId: draftIdValue,
    reviewedHash: parsed.data.hash,
    channelId: parsed.data.channelId,
    local: parsed.data.local,
    timeZone: parsed.data.timeZone,
  })
  revalidatePath(`/dashboard/projects/${projectIdValue}`)
  if (!result.ok) return { status: 'refused', reason: result.reason }
  return {
    status: 'scheduled',
    id: result.id,
    scheduledFor: result.scheduledFor,
  }
}

// ---- Cancel and refresh ----

export type CancelState =
  | { status: 'ok'; result: CancelResult }
  | { status: 'limited' | 'not_found' | 'failed' }

export async function cancelScheduleAction(
  projectIdValue: string,
  scheduleId: string,
): Promise<CancelState> {
  const user = await start()
  if (!projectIdSchema.safeParse(projectIdValue).success) notFound()
  if (!uuid.safeParse(scheduleId).success) return { status: 'not_found' }
  if (!(await rateLimit('bufferCancel', user.id))) return { status: 'limited' }

  // It must be one of this person's own schedules (cancelSchedule checks again).
  const own = await getScheduledPost(user.id, scheduleId)
  if (own === 'not_found') return { status: 'not_found' }
  if (own === 'failed') return { status: 'failed' }

  const result = await cancelSchedule({ userId: user.id, id: scheduleId })
  revalidatePath(`/dashboard/projects/${projectIdValue}`)
  if (result === 'not_found') return { status: 'not_found' }
  return { status: 'ok', result }
}

export type RefreshState =
  | { status: 'ok'; updated: number }
  | {
      status:
        | 'limited'
        | 'needs_reconnect'
        | 'rate_limited'
        | 'unavailable'
        | 'failed'
    }

export async function refreshStatusAction(
  projectIdValue: string,
): Promise<RefreshState> {
  const user = await start()
  if (!projectIdSchema.safeParse(projectIdValue).success) notFound()
  if (!(await rateLimit('bufferRefresh', user.id))) return { status: 'limited' }
  const project = await getProject(user.id, projectIdValue)
  if (!project.ok) {
    if (project.reason === 'not_found') notFound()
    return { status: 'failed' }
  }
  const result = await refreshStatuses({
    userId: user.id,
    projectId: projectIdValue,
  })
  revalidatePath(`/dashboard/projects/${projectIdValue}`)
  return result.ok
    ? { status: 'ok', updated: result.updated }
    : { status: result.reason }
}
