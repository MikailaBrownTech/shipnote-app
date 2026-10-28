// The authenticity checker: pure code, no second model call. It never blocks
// copying; the warnings are shown beside the draft. It is a smell test, not a
// proof: it catches a few obvious ways a draft stops sounding like the person
// or says things the input does not support, and it misses plenty.
//
// Imports only sibling pure modules, so scripts/draft-compare.ts can load it.
import {
  countWords,
  findCompletedWords,
  findStockPhrases,
  MAX_HASHTAGS,
  WORD_RANGE,
} from './draft-rules.ts'
import type { Stage } from './draft-input.ts'
import { findAvoidWords, longestCopiedRun } from './voice-check.ts'

export type DraftWarningCode =
  | 'stock_phrase'
  | 'unsupported_number'
  | 'unsupported_name'
  | 'completed_language'
  | 'length'
  | 'hashtags'
  | 'emoji'
  | 'dash'
  | 'avoid_word'
  | 'copied_sample'

export type DraftWarning = { code: DraftWarningCode; message: string }

// Numbers as written: 12, 3.5, 1,200. Commas are dropped so 1,200 = 1200.
const NUMBER = /\d+(?:[.,]\d+)*/g

export function numbersIn(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(NUMBER)) {
    found.add(match[0].replace(/,/g, '').replace(/\.$/, ''))
  }
  return found
}

// Words that may be capitalised without being a fact from the input.
const ALWAYS_OK = new Set(['i', 'linkedin'])

function wordsIn(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  )
}

// Capitalised words that are not at the start of a sentence, and that the
// input never used (compared without regard to case).
function unsupportedNames(body: string, vocabulary: Set<string>): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const pattern = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu
  for (const match of body.matchAll(pattern)) {
    const word = match[0]
    const first = word.charAt(0)
    if (first !== first.toUpperCase() || first === first.toLowerCase()) continue
    // The start of the text, or of a sentence or line.
    const before = body.slice(0, match.index).trimEnd()
    if (
      before === '' ||
      /[.!?:]$/.test(before) ||
      body[match.index - 1] === '\n'
    ) {
      continue
    }
    const base = word.replace(/['’]s?$/i, '').toLowerCase()
    if (ALWAYS_OK.has(base) || /^i['’]/i.test(word)) continue
    if (vocabulary.has(base) || vocabulary.has(base.replace(/s$/, ''))) continue
    if (seen.has(base)) continue
    seen.add(base)
    names.push(word)
  }
  return names
}

const quoted = (items: readonly string[]) =>
  items.map((item) => `"${item}"`).join(', ')

// `inputText` is everything the model was given (see inputText in
// draft-input.ts). For a saved draft the original input is no longer known, so
// pass null: the number and name checks, which need it, are then skipped.
export function checkDraft(input: {
  body: string
  stage: Stage
  inputText: string | null
  // The user's voice, when the draft was written with one: words to avoid and
  // sample posts. Without it these two checks are skipped.
  voice?: {
    avoidWords: readonly string[]
    samples: readonly string[]
  } | null
}): DraftWarning[] {
  const { body, stage } = input
  const warnings: DraftWarning[] = []

  const stock = findStockPhrases(body)
  if (stock.length > 0) {
    warnings.push({
      code: 'stock_phrase',
      message: `Stock phrase: ${quoted(stock)}. Say it in your own words.`,
    })
  }

  const source = input.inputText
  const allowedNumbers = numbersIn(source ?? '')
  const badNumbers =
    source === null
      ? []
      : [...numbersIn(body)].filter((n) => !allowedNumbers.has(n))
  if (badNumbers.length > 0) {
    warnings.push({
      code: 'unsupported_number',
      message: `${badNumbers.length === 1 ? 'This number is' : 'These numbers are'} not in your notes or commits: ${quoted(badNumbers)}. Check or remove ${badNumbers.length === 1 ? 'it' : 'them'}.`,
    })
  }

  const names =
    source === null ? [] : unsupportedNames(body, wordsIn(source)).slice(0, 8)
  if (names.length > 0) {
    warnings.push({
      code: 'unsupported_name',
      message: `${names.length === 1 ? 'This name or term does' : 'These names or terms do'} not appear in your notes or commits: ${quoted(names)}. Check ${names.length === 1 ? 'it' : 'them'}.`,
    })
  }

  if (stage !== 'shipped') {
    const completed = findCompletedWords(body)
    if (completed.length > 0) {
      warnings.push({
        code: 'completed_language',
        message: `This project is ${stage === 'idea' ? 'an idea' : 'in progress'}, but the draft says ${quoted(completed)}. Make sure it does not claim finished work.`,
      })
    }
  }

  const words = countWords(body)
  if (words < WORD_RANGE.min || words > WORD_RANGE.max) {
    warnings.push({
      code: 'length',
      message: `${String(words)} words. A post of ${String(WORD_RANGE.min)} to ${String(WORD_RANGE.max)} words reads best.`,
    })
  }

  const hashtags = (body.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length
  if (hashtags > MAX_HASHTAGS) {
    warnings.push({
      code: 'hashtags',
      message: `${String(hashtags)} hashtags. Two at most, and only if they fit.`,
    })
  }

  if (/\p{Extended_Pictographic}/u.test(body)) {
    warnings.push({ code: 'emoji', message: 'Contains an emoji.' })
  }
  if (/[–—]/.test(body)) {
    warnings.push({ code: 'dash', message: 'Contains an em dash or en dash.' })
  }

  if (input.voice) {
    const avoided = findAvoidWords(body, input.voice.avoidWords)
    if (avoided.length > 0) {
      warnings.push({
        code: 'avoid_word',
        message: `This uses ${avoided.length === 1 ? 'a word' : 'words'} you asked to avoid: ${quoted(avoided)}.`,
      })
    }
    const run = longestCopiedRun(body, input.voice.samples)
    if (run > 0) {
      warnings.push({
        code: 'copied_sample',
        message: `This copies ${String(run)} words in a row from one of your sample posts. Say it in new words.`,
      })
    }
  }
  return warnings
}
