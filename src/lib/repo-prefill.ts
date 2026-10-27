import { countChars, PROJECT_LIMITS } from './project-schema'

// Turns what GitHub says about a repository into the values the new-project
// form starts with. This only builds values: nothing here saves anything, and
// the person reviews and edits them before pressing Create.

export type Prefill = {
  name: string
  summary: string
  stage: 'in_progress'
  notes: string
  // True when the README had more than the notes limit, or was cut while being
  // read, so the person is told the notes are only the start of it.
  truncated: boolean
  hasReadme: boolean
}

// A byte order mark some editors put at the start of a file.
const BOM = String.fromCharCode(0xfeff)

// Counted in characters, like the database, so an emoji is not split.
const clip = (value: string, max: number) =>
  countChars(value) <= max ? value : Array.from(value).slice(0, max).join('')

export function buildPrefill(input: {
  repoName: string
  description: string | null
  // null when the repository has no README.
  readme: string | null
  // True when the README was longer than the amount that was read.
  readmeCut: boolean
}): Prefill {
  const name = clip(input.repoName.trim(), PROJECT_LIMITS.name)

  // A description is meant to be one line; collapse any whitespace.
  const summary = clip(
    (input.description ?? '').replace(/\s+/g, ' ').trim(),
    PROJECT_LIMITS.summary,
  )

  // Same cleaning the form applies on save: LF line breaks, no NUL (Postgres
  // cannot store it), and no byte order mark.
  const readme = (input.readme ?? '')
    .replace(BOM, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
  const truncated = input.readmeCut || countChars(readme) > PROJECT_LIMITS.notes

  return {
    name,
    summary,
    stage: 'in_progress',
    notes: clip(readme, PROJECT_LIMITS.notes).trimEnd(),
    truncated,
    hasReadme: input.readme !== null,
  }
}
