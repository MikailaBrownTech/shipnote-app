'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import type { DraftWarning } from '@/lib/draft-checker'
import { checkDraft } from '@/lib/draft-checker'
import { MAX_DRAFT_CHARS } from '@/lib/draft-output'
import { INPUT_LIMITS } from '@/lib/draft-input'
import { countChars, projectId } from '@/lib/project-schema'
import {
  aiIsEnabled,
  draftsLeftToday,
  generateDraft,
  type GenerateFailure,
} from '@/server/draft-generation'
import { deleteDraft, markDraftCopied, updateDraftBody } from '@/server/drafts'
import { getProject } from '@/server/projects'
import { rateLimit } from '@/server/rate-limit'

// Every action here calls requireUser() itself, 404s while AI is off, checks
// its input with Zod, and acts only on the signed-in user's own records: a
// missing id and someone else's id look the same. Results are fixed codes, never
// text from the model, GitHub or the database. Nothing here logs.

const MAX_COMMITS = 5

const shaList = z
  .array(z.string().regex(/^[0-9a-fA-F]{7,40}$/))
  .max(MAX_COMMITS)

const generateInput = z.strictObject({
  shas: shaList,
  note: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .refine((value) => countChars(value) <= INPUT_LIMITS.note)
    .refine((value) => !value.includes('\u0000')),
})

const bodyInput = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .refine((value) => countChars(value) <= MAX_DRAFT_CHARS)
      .refine((value) => !value.includes('\u0000')),
  )

const draftId = z.uuid()

async function start(id: string) {
  const user = await requireUser()
  if (!aiIsEnabled()) notFound()
  if (!projectId.safeParse(id).success) notFound()
  return user
}

const projectPath = (id: string) => `/dashboard/projects/${id}`

export type GenerateState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'limited' }
  | {
      status: 'ok'
      draft: { id: string; body: string; warnings: DraftWarning[] }
      left: number
    }
  | {
      status: 'refused'
      reason: Exclude<GenerateFailure, 'disabled' | 'not_found'>
      // Kinds of secret found (names only).
      secretKinds?: string[]
      left: number | null
    }

// Used with useActionState: (project id, previous state, form).
export async function generateDraftAction(
  id: string,
  _previous: GenerateState,
  form: FormData,
): Promise<GenerateState> {
  const user = await start(id)

  const note = form.get('note')
  const parsed = generateInput.safeParse({
    shas: form.getAll('sha').filter((v): v is string => typeof v === 'string'),
    note: typeof note === 'string' ? note : '',
  })
  if (!parsed.success) return { status: 'invalid' }
  // Repeats are the same commit.
  const shas = [...new Set(parsed.data.shas.map((sha) => sha.toLowerCase()))]

  // An extra brake only; the daily limit and monthly cap are in Postgres.
  if (!(await rateLimit('draftGenerate', user.id))) return { status: 'limited' }

  const result = await generateDraft({
    userId: user.id,
    projectId: id,
    shas,
    note: parsed.data.note,
  })
  if (!result.ok) {
    if (result.reason === 'not_found' || result.reason === 'disabled') {
      notFound()
    }
    return {
      status: 'refused',
      reason: result.reason,
      secretKinds: result.secretKinds,
      left: await draftsLeftToday(user.id),
    }
  }
  revalidatePath(projectPath(id))
  return { status: 'ok', draft: result.draft, left: result.left }
}

export type EditState =
  | { status: 'ok'; warnings: DraftWarning[] }
  | { status: 'invalid' | 'limited' | 'not_found' | 'failed' }

// Saves the person's edits to one of their own drafts. The warnings are worked
// out again from the new text (the original input is not stored, so the number
// and name checks are skipped).
export async function saveDraftAction(
  id: string,
  projectIdValue: string,
  body: string,
): Promise<EditState> {
  const user = await start(projectIdValue)
  if (!draftId.safeParse(id).success) return { status: 'not_found' }
  const text = bodyInput.safeParse(body)
  if (!text.success) return { status: 'invalid' }
  if (!(await rateLimit('draftEdit', user.id))) return { status: 'limited' }

  const result = await updateDraftBody(user.id, id, text.data)
  if (result === 'not_found') return { status: 'not_found' }
  if (result === 'failed') return { status: 'failed' }
  const project = await getProject(user.id, projectIdValue)
  return {
    status: 'ok',
    warnings: project.ok
      ? checkDraft({
          body: text.data,
          stage: project.value.stage,
          inputText: null,
        })
      : [],
  }
}

// The browser has already put the text on the clipboard. This saves the final
// text and marks the draft copied, which marks its commits as used.
export async function copyDraftAction(
  id: string,
  projectIdValue: string,
  body: string,
): Promise<EditState> {
  const user = await start(projectIdValue)
  if (!draftId.safeParse(id).success) return { status: 'not_found' }
  const text = bodyInput.safeParse(body)
  if (!text.success) return { status: 'invalid' }
  if (!(await rateLimit('draftEdit', user.id))) return { status: 'limited' }

  const saved = await updateDraftBody(user.id, id, text.data)
  if (saved === 'not_found') return { status: 'not_found' }
  if (saved === 'failed') return { status: 'failed' }
  const marked = await markDraftCopied(id)
  if (marked === 'not_found') return { status: 'not_found' }
  if (marked === 'failed') return { status: 'failed' }
  revalidatePath(projectPath(projectIdValue))
  return { status: 'ok', warnings: [] }
}

export async function discardDraftAction(
  id: string,
  projectIdValue: string,
): Promise<EditState> {
  const user = await start(projectIdValue)
  if (!draftId.safeParse(id).success) return { status: 'not_found' }
  if (!(await rateLimit('draftEdit', user.id))) return { status: 'limited' }
  const result = await deleteDraft(user.id, id)
  if (result === 'not_found') return { status: 'not_found' }
  if (result === 'failed') return { status: 'failed' }
  revalidatePath(projectPath(projectIdValue))
  return { status: 'ok', warnings: [] }
}
