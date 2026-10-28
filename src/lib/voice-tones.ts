// The tones a user can choose for their drafts, in one place. The instruction
// for each tone is FIXED TEXT written here: it is never taken from a user, and
// it is the only text about a tone that reaches the model. The label, the
// description and the example are for the settings screen.
//
// No imports, so scripts and the prompt builder can load it directly.

export const TONE_IDS = [
  'professional',
  'academic',
  'casual',
  'friendly',
  'direct',
  'storyteller',
  'humble',
] as const

export type ToneId = (typeof TONE_IDS)[number]

export const DEFAULT_TONE: ToneId = 'professional'

export type Tone = {
  label: string
  // One plain line for the picker.
  description: string
  // A made-up sentence in the tone, for the picker. Not sent to the model.
  example: string
  // What the model is told. Short on purpose: it is paid for on every draft.
  instruction: string
}

export const TONES: Readonly<Record<ToneId, Tone>> = {
  professional: {
    label: 'Professional',
    description: 'Clear and measured, the way you would write to a colleague.',
    example: 'This week I reworked how the app stores reports.',
    instruction:
      'Clear and measured. Plain, business-appropriate wording and steady sentences. No slang.',
  },
  academic: {
    label: 'Academic',
    description:
      'Precise and careful, with the problem, the method and the result.',
    example:
      'The problem was slow report loading, so I changed how the data is queried.',
    instruction:
      'Precise and analytical. Name the problem, the approach and the result. Careful about claims, formal but readable.',
  },
  casual: {
    label: 'Casual',
    description: 'Relaxed and conversational, like chatting.',
    example:
      'Spent the week fixing why reports were so slow. Mostly sorted now.',
    instruction:
      'Relaxed and conversational. Contractions are fine. Short sentences, like chatting with a colleague.',
  },
  friendly: {
    label: 'Friendly',
    description: 'Warm and welcoming, talking to the reader.',
    example: 'If you have ever waited on a slow report, this one is for you.',
    instruction:
      'Warm and approachable. Speak to the reader directly with a light touch of enthusiasm, without exaggeration.',
  },
  direct: {
    label: 'Direct',
    description: 'Short and to the point, no filler.',
    example: 'Reports were slow. I fixed the query. They load faster now.',
    instruction:
      'Brief and blunt. Lead with the point. Short sentences. No filler and no hedging.',
  },
  storyteller: {
    label: 'Storyteller',
    description:
      'Told as a short story: the problem, what was tried, what happened.',
    example:
      'The report page kept timing out, so I started by looking at the query.',
    instruction:
      'Tell it as a short story: the problem, what was tried, what happened. Use only moments that are in the data. Never invent scenes or details.',
  },
  humble: {
    label: 'Humble',
    description: 'Modest and honest about what is still rough.',
    example:
      'I learned a lot fixing report loading, and a few rough edges remain.',
    instruction:
      'Modest and honest. Credit what was learned, say what is still rough, and do not boast.',
  },
}

export function isToneId(value: unknown): value is ToneId {
  return (
    typeof value === 'string' && (TONE_IDS as readonly string[]).includes(value)
  )
}
