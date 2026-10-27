// What is sent to the model for one draft, and the caps that keep it small.
// Everything here is untrusted data (notes, README text, commit messages). It
// is cleaned and capped, then placed in delimited blocks by draft-prompt.ts.
//
// No imports, so scripts/draft-compare.ts can load it directly.

export type Stage = 'idea' | 'in_progress' | 'shipped'

export const INPUT_LIMITS = {
  name: 80,
  summary: 300,
  // Only the start of the notes is used: it keeps the call small and cheap.
  notes: 4000,
  // First line and body together.
  commitMessage: 500,
  note: 500,
  commits: 5,
} as const

export type DraftCommit = { sha: string; message: string }

export type DraftInputData = {
  stage: Stage
  name: string
  summary: string
  notes: string
  commits: DraftCommit[]
  note: string
}

// Counted in characters, so an emoji is not cut in half.
export function clipChars(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

// Removes control characters (keeping line breaks and tabs), and breaks up any
// run of "=" so text inside a data block cannot imitate a block boundary.
export function cleanData(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/={3,}/g, '==')
    .trim()
}

// Applies every cap. The result can be put in a prompt as it is.
export function buildDraftInput(raw: {
  stage: Stage
  name: string
  summary: string | null
  notes: string
  commits: readonly DraftCommit[]
  note: string
}): DraftInputData {
  return {
    stage: raw.stage,
    name: clipChars(cleanData(raw.name), INPUT_LIMITS.name),
    summary: clipChars(
      cleanData(raw.summary ?? '').replace(/\s+/g, ' '),
      INPUT_LIMITS.summary,
    ),
    notes: clipChars(cleanData(raw.notes), INPUT_LIMITS.notes),
    commits: raw.commits.slice(0, INPUT_LIMITS.commits).map((commit) => ({
      sha: commit.sha.toLowerCase().slice(0, 40),
      message: clipChars(cleanData(commit.message), INPUT_LIMITS.commitMessage),
    })),
    note: clipChars(cleanData(raw.note), INPUT_LIMITS.note),
  }
}

// A draft needs something to write from: a commit or a note.
export function hasContent(data: DraftInputData): boolean {
  return data.commits.length > 0 || data.note.length > 0
}

// Every word the model was given, as one text. The checker uses it to tell
// facts that came from the input from facts that did not.
export function inputText(data: DraftInputData): string {
  return [
    data.name,
    data.summary,
    data.notes,
    data.note,
    ...data.commits.map((commit) => commit.message),
  ].join('\n')
}

// A rough size in characters, for estimating cost before the call.
export function inputChars(data: DraftInputData, systemChars: number): number {
  return systemChars + inputText(data).length + data.commits.length * 12 + 400
}
