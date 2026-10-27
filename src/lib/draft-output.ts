// Checks what the model sent back before anything is stored or shown. A draft
// that fails is rejected, not stored, and not retried.
//
// Imports only zod and sibling pure modules, so scripts/draft-compare.ts can load it.
import { z } from 'zod'
import { BLOCK_LABELS } from './draft-prompt.ts'

export const MAX_DRAFT_CHARS = 3000

export type OutputRejection =
  | 'empty'
  | 'too_long'
  | 'cut_off' // the model hit the output limit mid-sentence
  | 'markdown'
  | 'link'
  | 'delimiter' // leftover block-boundary text, or the request's code

export type OutputCheck =
  { ok: true; body: string } | { ok: false; reason: OutputRejection }

const draftText = z.string().trim().min(1).max(MAX_DRAFT_CHARS)

const MARKDOWN: RegExp[] = [
  /^\s{0,3}#{1,6}\s/m, // headings
  /^\s*[-*+•]\s+\S/m, // bullet lists
  /^\s*\d{1,2}[.)]\s+\S/m, // numbered lists
  /^\s*>\s/m, // block quotes
  /\*\*[^*\n]+\*\*/, // bold
  /(^|\s)__[^_\n]+__(\s|$)/, // bold with underscores
  /`/, // code
  /^\s*\|.*\|\s*$/m, // tables
  /\[[^\]\n]+\]\([^)\n]*\)/, // [text](url)
  /^\s*[-=]{3,}\s*$/m, // rules
]

const LINKS: RegExp[] = [
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\bmailto:/i,
  // A bare domain, such as "example.com" or "my-app.dev".
  /\b[a-z0-9][a-z0-9-]*\.(com|org|net|io|dev|app|ai|co|me|ly|gg|xyz|sh)\b/i,
]

// `nonce` is the code that was in this request's data blocks; the answer must
// not repeat it.
export function validateDraftOutput(
  text: string,
  options: { nonce?: string; stopReason?: string | null } = {},
): OutputCheck {
  if (options.stopReason === 'max_tokens')
    return { ok: false, reason: 'cut_off' }

  const shape = draftText.safeParse(text)
  if (!shape.success) {
    return {
      ok: false,
      reason: text.trim().length === 0 ? 'empty' : 'too_long',
    }
  }
  // Same line endings the form uses: LF.
  const body = shape.data.replace(/\r\n?/g, '\n')

  if (
    body.includes('=====') ||
    BLOCK_LABELS.some(
      (label) =>
        body.includes(`BEGIN ${label}`) || body.includes(`END ${label}`),
    ) ||
    (options.nonce && body.includes(options.nonce))
  ) {
    return { ok: false, reason: 'delimiter' }
  }
  if (LINKS.some((pattern) => pattern.test(body)))
    return { ok: false, reason: 'link' }
  if (MARKDOWN.some((pattern) => pattern.test(body))) {
    return { ok: false, reason: 'markdown' }
  }
  return { ok: true, body }
}
