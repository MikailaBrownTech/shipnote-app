// The writing rules for a draft, in one place. The system prompt tells the
// model these rules, and the checker looks for breaches of the same ones, so
// the two cannot drift apart.
//
// No imports, so scripts/draft-compare.ts can load it directly.

// Words and phrases that make a post read like everyone else's. A phrase
// matches at the start of a word and through its ending, so "unlock" also
// catches "unlocked" and "unlocking".
export const STOCK_PHRASES = [
  'excited to announce',
  'excited to share',
  'thrilled',
  'proud to announce',
  'pleased to announce',
  'game-changer',
  'game changer',
  'delve',
  'delving',
  'unlock',
  'leverage',
  'leveraging',
  'in today’s fast-paced world',
  "in today's fast-paced world",
  'fast-paced world',
  'take it to the next level',
  'next level',
  'cutting-edge',
  'revolutionize',
  'revolutionary',
  'seamless',
  'robust solution',
  'passionate about',
  'at the end of the day',
  'stay tuned',
  'synergy',
  'humbled',
] as const

// Wording that says work is finished. Only fine when the project is shipped.
export const COMPLETED_WORDS = [
  'launched',
  'shipped',
  'released',
  'live',
] as const

export const WORD_RANGE = { min: 90, max: 180 } as const

// A hashtag or two, only if natural. Never a wall of them.
export const MAX_HASHTAGS = 2

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The stock phrases found in a text, each named once, in the order they appear.
export function findStockPhrases(text: string): string[] {
  const found: { phrase: string; at: number }[] = []
  for (const phrase of STOCK_PHRASES) {
    const match = new RegExp(`(?<![a-z0-9])${escape(phrase)}\\w*`, 'i').exec(
      text,
    )
    if (match) found.push({ phrase, at: match.index })
  }
  found.sort((a, b) => a.at - b.at)
  const seen = new Set<string>()
  return found
    .map((item) => item.phrase)
    .filter((phrase) => {
      const key = phrase.replace('’', "'")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function findCompletedWords(text: string): string[] {
  return COMPLETED_WORDS.filter((word) =>
    new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`, 'i').test(text),
  )
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// The list as the system prompt prints it.
export function stockPhraseList(): string {
  const unique = new Set<string>()
  for (const phrase of STOCK_PHRASES) {
    unique.add(phrase.replace('’', "'"))
  }
  return [...unique].map((phrase) => `"${phrase}"`).join(', ')
}
