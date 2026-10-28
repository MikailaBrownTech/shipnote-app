// Two checks that only make sense with a voice: the draft uses a word the user
// asked to avoid, or it copies a long run of words from one of their sample
// posts. Pure code, like the rest of the checker. They warn; they never block.
//
// No imports, so the draft checker and scripts can load it.

export const COPY_RUN_WORDS = 8

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The avoid words (or phrases) that appear in the text, as whole words, ignoring
// case. Each is named once, as the user wrote it.
export function findAvoidWords(
  text: string,
  words: readonly string[],
): string[] {
  const found: string[] = []
  for (const word of words) {
    if (word.trim() === '') continue
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(word.trim())}(?![\\p{L}\\p{N}])`,
      'iu',
    )
    if (pattern.test(text) && !found.includes(word)) found.push(word)
  }
  return found
}

// Words as they are compared: lower case, with punctuation and spacing gone.
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll('’', "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
}

// The longest run of words the text shares with any one sample, or 0 when it
// is shorter than `minWords`. Punctuation and capitals do not matter.
export function longestCopiedRun(
  text: string,
  samples: readonly string[],
  minWords = COPY_RUN_WORDS,
): number {
  const body = tokens(text)
  let longest = 0
  for (const sample of samples) {
    const source = tokens(sample)
    for (let i = 0; i < body.length; i += 1) {
      for (let j = 0; j < source.length; j += 1) {
        if (body[i] !== source[j]) continue
        let length = 1
        while (
          i + length < body.length &&
          j + length < source.length &&
          body[i + length] === source[j + length]
        ) {
          length += 1
        }
        if (length > longest) longest = length
      }
    }
  }
  return longest >= minWords ? longest : 0
}
