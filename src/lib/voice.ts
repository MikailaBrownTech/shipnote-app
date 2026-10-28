// A user's voice: the tone, notes, sample posts, words to avoid and sign-off
// that shape their drafts. This file defines the limits, cleans a profile
// before it goes in a prompt, and finds secrets in it.
//
// Everything a user writes here is untrusted style data. It is cleaned and
// capped again every time it is used, even though the database also enforces
// the limits, so a profile written by any route cannot grow a prompt.
//
// Imports only sibling pure modules, so scripts can load it.
import { cleanData, clipChars } from './draft-input.ts'
import { findSecrets, type SecretFinding } from './secret-scan.ts'
import { DEFAULT_TONE, isToneId, type ToneId } from './voice-tones.ts'

export const VOICE_LIMITS = {
  notes: 500,
  samples: 3,
  sample: 1500,
  avoidWords: 15,
  avoidWord: 30,
  signoff: 80,
} as const

export type VoiceProfile = {
  tone: ToneId
  notes: string
  samples: string[]
  avoidWords: string[]
  signoff: string
}

export const DEFAULT_VOICE: VoiceProfile = {
  tone: DEFAULT_TONE,
  notes: '',
  samples: [],
  avoidWords: [],
  signoff: '',
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim()

// Any shape in, a safe profile out: a known tone, capped and cleaned text.
export function normalizeVoice(raw: {
  tone?: unknown
  notes?: unknown
  samples?: unknown
  avoidWords?: unknown
  signoff?: unknown
}): VoiceProfile {
  const texts = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []

  const seen = new Set<string>()
  const avoidWords: string[] = []
  for (const item of texts(raw.avoidWords)) {
    const word = clipChars(oneLine(cleanData(item)), VOICE_LIMITS.avoidWord)
    if (word === '' || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    avoidWords.push(word)
  }

  return {
    tone: isToneId(raw.tone) ? raw.tone : DEFAULT_TONE,
    notes: clipChars(
      cleanData(typeof raw.notes === 'string' ? raw.notes : ''),
      VOICE_LIMITS.notes,
    ),
    samples: texts(raw.samples)
      .map((item) => clipChars(cleanData(item), VOICE_LIMITS.sample))
      .filter((item) => item !== '')
      .slice(0, VOICE_LIMITS.samples),
    avoidWords: avoidWords.slice(0, VOICE_LIMITS.avoidWords),
    signoff: clipChars(
      oneLine(cleanData(typeof raw.signoff === 'string' ? raw.signoff : '')),
      VOICE_LIMITS.signoff,
    ),
  }
}

// True when the voice adds nothing to a draft: the default tone and no text.
// Such a voice is left out of the prompt, so a user with no settings gets
// exactly the prompt they always had.
export function isDefaultVoice(voice: VoiceProfile): boolean {
  return (
    voice.tone === DEFAULT_TONE &&
    voice.notes === '' &&
    voice.samples.length === 0 &&
    voice.avoidWords.length === 0 &&
    voice.signoff === ''
  )
}

export type VoiceSecret = {
  // Where, in words for the user: "the voice notes", "sample post 2".
  where: string
  findings: SecretFinding[]
}

// Looks for things that look like keys or tokens in every free-text field.
// Reports the kind and the line only, never the text.
export function findVoiceSecrets(voice: VoiceProfile): VoiceSecret[] {
  const fields: [string, string][] = [
    ['the voice notes', voice.notes],
    ...voice.samples.map((sample, index): [string, string] => [
      `sample post ${String(index + 1)}`,
      sample,
    ]),
    ['the avoid words', voice.avoidWords.join('\n')],
    ['the sign-off', voice.signoff],
  ]
  const found: VoiceSecret[] = []
  for (const [where, text] of fields) {
    if (text === '') continue
    const findings = findSecrets(text)
    if (findings.length > 0) found.push({ where, findings })
  }
  return found
}
