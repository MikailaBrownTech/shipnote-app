import { z } from 'zod'
import { describeSecrets, findSecrets } from './secret-scan'

// These mirror the check constraints in
// supabase/migrations/20261027000100_projects.sql. Keep them in step.
export const PROJECT_LIMITS = {
  name: 80,
  summary: 300,
  notes: 12_000,
  perUser: 5,
} as const

export const STAGES = ['idea', 'in_progress', 'shipped'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  idea: 'Idea',
  in_progress: 'In progress',
  shipped: 'Shipped',
}

// Postgres counts characters (code points), and so does this. A string's
// .length counts UTF-16 units, which would count an emoji twice.
export const countChars = (value: string) => Array.from(value).length

// A browser sends line breaks in a textarea as CRLF. Store LF, so the count the
// person sees is the count the database sees.
const clean = (value: string) => value.replace(/\r\n?/g, '\n').trim()

// Postgres text cannot hold a NUL character.
const noNul = (value: string) => !value.includes('\u0000')

function text(max: number) {
  return z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .refine((value) => countChars(value) <= max)
        .refine(noNul),
    )
}

// Unknown fields are rejected, so nothing such as user_id can ride along.
export const projectInput = z.strictObject({
  name: text(PROJECT_LIMITS.name).pipe(z.string().min(1)),
  summary: text(PROJECT_LIMITS.summary).transform((value) =>
    value === '' ? null : value,
  ),
  stage: z.enum(STAGES),
  notes: text(PROJECT_LIMITS.notes),
})
export type ProjectInput = z.infer<typeof projectInput>

export const projectId = z.uuid()

export type ProjectField = 'name' | 'summary' | 'stage' | 'notes'
export type FieldErrors = Partial<Record<ProjectField, string>>

// Fixed wording. Never built from what the person typed.
export const FIELD_MESSAGES: Record<ProjectField, string> = {
  name: `Enter a name of 1 to ${String(PROJECT_LIMITS.name)} characters.`,
  summary: `Keep the summary to ${String(PROJECT_LIMITS.summary)} characters or fewer.`,
  stage: 'Choose a stage.',
  notes: `Keep the notes to ${String(PROJECT_LIMITS.notes)} characters or fewer.`,
}

function secretErrors(data: ProjectInput): FieldErrors | null {
  const errors: FieldErrors = {}
  const parts: [ProjectField, string, string | null][] = [
    ['name', 'the name', data.name],
    ['summary', 'the summary', data.summary],
    ['notes', 'the notes', data.notes],
  ]
  for (const [field, where, value] of parts) {
    if (!value) continue
    const found = findSecrets(value)
    if (found.length > 0) errors[field] = describeSecrets(found, where)
  }
  return Object.keys(errors).length > 0 ? errors : null
}

export type ParsedProject =
  { ok: true; data: ProjectInput } | { ok: false; errors: FieldErrors }

function isField(value: unknown): value is ProjectField {
  return (
    value === 'name' ||
    value === 'summary' ||
    value === 'stage' ||
    value === 'notes'
  )
}

// Reads a submitted form. Next adds its own "$ACTION_..." fields; everything
// else must be a known field, so an extra one is refused by the strict schema.
export function parseProjectForm(form: FormData): ParsedProject {
  const raw: Record<string, FormDataEntryValue> = {}
  for (const [key, value] of form.entries()) {
    if (key.startsWith('$ACTION')) continue
    if (!(key in raw)) raw[key] = value
  }
  // A missing summary is the same as an empty one.
  if (!('summary' in raw)) raw.summary = ''

  const result = projectInput.safeParse(raw)
  if (result.success) {
    // A basic check for things that look like secrets (see secret-scan.ts).
    // It blocks the save and says what kind and where, never the text itself.
    const blocked = secretErrors(result.data)
    if (blocked) return { ok: false, errors: blocked }
    return { ok: true, data: result.data }
  }

  const errors: FieldErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (isField(field)) {
      errors[field] = FIELD_MESSAGES[field]
    } else {
      // An unknown field or a broken form: there is no field to point at.
      errors.name ??= FIELD_MESSAGES.name
    }
  }
  return { ok: false, errors }
}
