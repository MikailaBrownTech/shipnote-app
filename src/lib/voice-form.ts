// Reads the voice settings form. Pure, so every rule and message is tested
// without a server. Each refusal names the field and says what to change, in
// plain words, and never repeats what the user typed.
import { VOICE_LIMITS, type VoiceProfile } from './voice.ts'
import { isToneId } from './voice-tones.ts'

export type VoiceField = 'tone' | 'notes' | 'samples' | 'avoid' | 'signoff'

export type VoiceFormResult =
  | { ok: true; voice: VoiceProfile }
  | { ok: false; field: VoiceField; message: string }

const fail = (field: VoiceField, message: string): VoiceFormResult => ({
  ok: false,
  field,
  message,
})

const chars = (value: string) => Array.from(value).length

// Postgres cannot store a NUL character, and CR LF should be one line break.
const tidy = (value: string) =>
  value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n')

// Drafts never contain these, so a sign-off that does would make every draft
// fail its own checks.
const LINK =
  /(?:https?:|www\.|mailto:|\b[a-z0-9-]+\.(?:com|org|net|io|dev|app|ai|co|me|ly|gg|xyz|sh)\b)/i

export function parseVoiceForm(form: FormData): VoiceFormResult {
  const text = (name: string): string | null => {
    const value = form.get(name)
    return typeof value === 'string' ? tidy(value) : null
  }

  const tone = text('tone')
  if (tone === null || !isToneId(tone)) {
    return fail('tone', 'Choose one of the tones.')
  }

  const notes = text('notes')
  if (notes === null) return fail('notes', 'The voice notes could not be read.')
  if (chars(notes.trim()) > VOICE_LIMITS.notes) {
    return fail(
      'notes',
      `Keep the voice notes to ${String(VOICE_LIMITS.notes)} characters.`,
    )
  }

  const rawSamples = form.getAll('sample')
  const strings = rawSamples.filter((v): v is string => typeof v === 'string')
  if (strings.length !== rawSamples.length) {
    return fail('samples', 'The sample posts could not be read.')
  }
  const samples = strings
    .map((value) => tidy(value).trim())
    .filter((value) => value !== '')
  if (samples.length > VOICE_LIMITS.samples) {
    return fail(
      'samples',
      `Use at most ${String(VOICE_LIMITS.samples)} sample posts.`,
    )
  }
  const tooLong = samples.findIndex(
    (sample) => chars(sample) > VOICE_LIMITS.sample,
  )
  if (tooLong >= 0) {
    return fail(
      'samples',
      `Sample post ${String(tooLong + 1)} is too long. Keep each one to ${VOICE_LIMITS.sample.toLocaleString('en')} characters.`,
    )
  }

  const avoidText = text('avoid')
  if (avoidText === null) {
    return fail('avoid', 'The words to avoid could not be read.')
  }
  const avoidWords: string[] = []
  for (const part of avoidText.split(/[,\n]/)) {
    const word = part.replace(/\s+/g, ' ').trim()
    if (word === '') continue
    if (chars(word) > VOICE_LIMITS.avoidWord) {
      return fail(
        'avoid',
        `Each word or phrase to avoid can be up to ${String(VOICE_LIMITS.avoidWord)} characters.`,
      )
    }
    if (!avoidWords.some((w) => w.toLowerCase() === word.toLowerCase())) {
      avoidWords.push(word)
    }
  }
  if (avoidWords.length > VOICE_LIMITS.avoidWords) {
    return fail(
      'avoid',
      `List at most ${String(VOICE_LIMITS.avoidWords)} words or phrases to avoid.`,
    )
  }

  const signoffText = text('signoff')
  if (signoffText === null) {
    return fail('signoff', 'The sign-off could not be read.')
  }
  const signoff = signoffText.replace(/\s+/g, ' ').trim()
  if (chars(signoff) > VOICE_LIMITS.signoff) {
    return fail(
      'signoff',
      `Keep the sign-off to ${String(VOICE_LIMITS.signoff)} characters.`,
    )
  }
  if (
    LINK.test(signoff) ||
    /\p{Extended_Pictographic}/u.test(signoff) ||
    /[–—]/.test(signoff) ||
    /[\p{Cc}]/u.test(signoff)
  ) {
    return fail(
      'signoff',
      'The sign-off cannot include links, emoji or dashes, because drafts never do.',
    )
  }

  return {
    ok: true,
    voice: { tone, notes: notes.trim(), samples, avoidWords, signoff },
  }
}
