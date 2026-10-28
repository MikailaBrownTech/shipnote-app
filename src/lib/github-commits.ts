import { commitUrl } from './github-repo'

// What the page shows for a commit. Commit messages are untrusted text from
// anyone who can push, so only a short title is kept and it is always
// rendered as plain text.
export type CommitSummary = {
  sha: string // the first 7 characters
  title: string
  date: string | null
  url: string
}

export const MAX_COMMITS = 20
export const MAX_TITLE_CHARS = 200
export const WINDOW_DAYS = 30

type Raw = { sha: string; message: string; date: string | null }

const POST_TAG = /\[post\]/i

// Whether a commit is marked with [post] (any case). The tag counts only in the
// first line of the message, the subject: that is where a person puts it on
// purpose. The same words further down (a squash merge lists the messages of
// the commits it joins, and a commit that explains this feature mentions the
// tag) do not mark a commit. Every place that decides what is tagged, the page
// lists, the webhook and the automatic worker, goes through this function.
export function hasPostTag(message: string): boolean {
  return POST_TAG.test(message.split(/\r?\n/, 1)[0] ?? '')
}
const SHA = /^[0-9a-f]{7,64}$/i

// Counted in characters, not UTF-16 units, so an emoji is not split in half.
function clip(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`
}

// The first line of a commit message, trimmed and capped. A control character
// such as a NUL or an escape is dropped.
export function commitTitle(message: string): string {
  const cleaned = message.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    '',
  )
  const first = cleaned.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return first ? clip(first, MAX_TITLE_CHARS) : '(no message)'
}

// Keeps the commits marked [post] in their first line (any case), newest first as
// GitHub returned them, at most MAX_COMMITS. Does not return a diff, a file
// list or the rest of the message.
export function selectPostCommits(
  commits: readonly Raw[],
  fullName: string,
): CommitSummary[] {
  const found: CommitSummary[] = []
  for (const commit of commits) {
    if (!hasPostTag(commit.message)) continue
    if (!SHA.test(commit.sha)) continue
    found.push({
      sha: commit.sha.slice(0, 7).toLowerCase(),
      title: commitTitle(commit.message),
      date: commit.date,
      url: commitUrl(fullName, commit.sha.toLowerCase()),
    })
    if (found.length === MAX_COMMITS) break
  }
  return found
}

// 30 days back, in the form GitHub's `since` parameter takes.
export function sinceDate(nowMs: number): string {
  return new Date(nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
}

export type PostCommit = { sha: string; message: string }

// The same [post] commits selectPostCommits would show, with their full
// message and full sha, for building a draft. A draft may only use a commit
// that this returns.
export function postCommitsWithMessages(commits: readonly Raw[]): PostCommit[] {
  const found: PostCommit[] = []
  for (const commit of commits) {
    if (!hasPostTag(commit.message)) continue
    if (!SHA.test(commit.sha)) continue
    found.push({ sha: commit.sha.toLowerCase(), message: commit.message })
    if (found.length === MAX_COMMITS) break
  }
  return found
}
