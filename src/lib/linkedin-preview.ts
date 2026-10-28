// The rules behind the LinkedIn preview: when LinkedIn would cut a post with
// "…more", and which parts of the text are hashtags. Pure, so they are tested
// without a browser. No imports.

// LinkedIn cuts a post after about three lines or 210 characters.
export const CLAMP_CHARS = 210
export const CLAMP_LINES = 3

const HASHTAG = /^#[\p{L}\p{N}_]+$/u

// Whether a post is long enough that LinkedIn would cut it with "…more".
export function isCut(body: string): boolean {
  const text = body.replace(/\r\n?/g, '\n').trim()
  return (
    Array.from(text).length > CLAMP_CHARS ||
    text.split('\n').length > CLAMP_LINES
  )
}

export type Piece = { text: string; hashtag: boolean }

// The text as pieces, each plain or a hashtag. Putting the pieces back together
// gives the text exactly as it was.
export function splitHashtags(body: string): Piece[] {
  return body
    .split(/(#[\p{L}\p{N}_]+)/u)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hashtag: HASHTAG.test(part) }))
}

// The name shown for a post's profile, and the letter in its avatar.
export function profileName(name: string | null | undefined): {
  label: string
  initial: string | null
} {
  const clean = name?.trim() ?? ''
  return clean === ''
    ? { label: 'Your LinkedIn profile', initial: null }
    : { label: clean, initial: Array.from(clean)[0]?.toUpperCase() ?? null }
}
