'use client'

import { useActionState, useState } from 'react'
import { VOICE_LIMITS } from '@/lib/voice'
import { TONE_IDS, TONES, type ToneId } from '@/lib/voice-tones'
import { resetVoiceAction, saveVoiceAction, type VoiceState } from './actions'
import styles from './voice.module.css'

// The voice settings form. Everything is plain text: the user's words are only
// ever shown inside inputs and textareas, never rendered as markup. The fields
// are controlled, so a refused save keeps what was typed.

export type VoiceFormValues = {
  tone: ToneId
  notes: string
  samples: string[]
  avoid: string
  signoff: string
}

const idle: VoiceState = { status: 'idle' }

const MESSAGES = {
  saved: 'Saved. New drafts will use this voice.',
  reset: 'Back to the default voice.',
  limited: 'Too many changes. Try again in a few minutes.',
  failed: 'Something went wrong. Try again.',
} as const

function Counter({ used, max }: { used: number; max: number }) {
  return (
    <span
      className={`${styles.counter} ${used > max ? styles.over : ''}`}
      aria-live="off"
    >
      {used.toLocaleString('en')} / {max.toLocaleString('en')}
    </span>
  )
}

const chars = (value: string) => Array.from(value).length

export function VoiceForm({ initial }: { initial: VoiceFormValues }) {
  const [saveState, save, saving] = useActionState(saveVoiceAction, idle)
  const [resetState, reset, resetting] = useActionState(resetVoiceAction, idle)
  const [tone, setTone] = useState<ToneId>(initial.tone)
  const [notes, setNotes] = useState(initial.notes)
  const [samples, setSamples] = useState<string[]>(
    Array.from(
      { length: VOICE_LIMITS.samples },
      (_, index) => initial.samples[index] ?? '',
    ),
  )
  const [avoid, setAvoid] = useState(initial.avoid)
  const [signoff, setSignoff] = useState(initial.signoff)

  // The result of the button used last. A successful save or reset refreshes
  // the page, which remounts this form with the stored values.
  const [last, setLast] = useState<'save' | 'reset'>('save')
  const state = last === 'reset' ? resetState : saveState
  const busy = saving || resetting
  const fieldError = (name: string) =>
    state.status === 'invalid' && state.field === name ? state.message : null

  return (
    <form action={save} className={styles.form} noValidate>
      <fieldset className={`card ${styles.group}`}>
        <legend>Tone</legend>
        <p className={styles.hint}>
          How your posts should sound. You can pick a different tone for a
          single draft when you generate it.
        </p>
        <div className={styles.tones}>
          {TONE_IDS.map((id) => (
            <label
              key={id}
              className={`${styles.tone} ${tone === id ? styles.toneOn : ''}`}
            >
              <input
                type="radio"
                name="tone"
                value={id}
                checked={tone === id}
                onChange={() => {
                  setTone(id)
                }}
              />
              <strong>{TONES[id].label}</strong>
              <span>{TONES[id].description}</span>
              <em>&ldquo;{TONES[id].example}&rdquo;</em>
            </label>
          ))}
        </div>
        {fieldError('tone') ? (
          <p role="alert" className={styles.error}>
            {fieldError('tone')}
          </p>
        ) : null}
      </fieldset>

      <section className={`card ${styles.group}`}>
        <h2>In your own words</h2>
        <div className={styles.field}>
          <label htmlFor="voice-notes">
            How do you want to sound? <small>(optional)</small>
          </label>
          <textarea
            id="voice-notes"
            name="notes"
            rows={3}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value)
            }}
            aria-describedby="voice-notes-count"
            aria-invalid={fieldError('notes') ? true : undefined}
            placeholder="For example: short sentences, a dry sense of humour, no hype."
          />
          <div id="voice-notes-count" className={styles.meta}>
            <Counter used={chars(notes)} max={VOICE_LIMITS.notes} />
          </div>
          {fieldError('notes') ? (
            <p role="alert" className={styles.error}>
              {fieldError('notes')}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor="voice-avoid">
            Words to avoid <small>(optional)</small>
          </label>
          <input
            id="voice-avoid"
            name="avoid"
            type="text"
            value={avoid}
            onChange={(event) => {
              setAvoid(event.target.value)
            }}
            aria-describedby="voice-avoid-hint"
            aria-invalid={fieldError('avoid') ? true : undefined}
            placeholder="synergy, game changer"
          />
          <p id="voice-avoid-hint" className={styles.hint}>
            Up to {VOICE_LIMITS.avoidWords} words or phrases, separated by
            commas. Drafts that use one get a warning.
          </p>
          {fieldError('avoid') ? (
            <p role="alert" className={styles.error}>
              {fieldError('avoid')}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor="voice-signoff">
            Sign-off <small>(optional)</small>
          </label>
          <input
            id="voice-signoff"
            name="signoff"
            type="text"
            value={signoff}
            onChange={(event) => {
              setSignoff(event.target.value)
            }}
            maxLength={VOICE_LIMITS.signoff}
            aria-describedby="voice-signoff-hint"
            aria-invalid={fieldError('signoff') ? true : undefined}
            placeholder="Thanks for reading"
          />
          <p id="voice-signoff-hint" className={styles.hint}>
            Plain text on one line, up to {VOICE_LIMITS.signoff} characters. No
            links, emoji or dashes. Drafts end with it.
          </p>
          {fieldError('signoff') ? (
            <p role="alert" className={styles.error}>
              {fieldError('signoff')}
            </p>
          ) : null}
        </div>
      </section>

      <section className={`card ${styles.group}`}>
        <h2>Posts you wrote</h2>
        <p className={styles.hint}>
          Paste up to {VOICE_LIMITS.samples} posts you wrote yourself. They
          teach Shipnote your rhythm and word choice. Facts in them are never
          reused in a draft. Longer samples use slightly more of the monthly
          drafting pool.
        </p>
        {samples.map((sample, index) => {
          const id = `voice-sample-${String(index + 1)}`
          return (
            <div key={id} className={styles.field}>
              <label htmlFor={id}>Sample post {index + 1}</label>
              <textarea
                id={id}
                name="sample"
                rows={5}
                value={sample}
                onChange={(event) => {
                  const next = [...samples]
                  next[index] = event.target.value
                  setSamples(next)
                }}
                aria-describedby={`${id}-count`}
                aria-invalid={fieldError('samples') ? true : undefined}
              />
              <div id={`${id}-count`} className={styles.meta}>
                <Counter used={chars(sample)} max={VOICE_LIMITS.sample} />
              </div>
            </div>
          )
        })}
        {fieldError('samples') ? (
          <p role="alert" className={styles.error}>
            {fieldError('samples')}
          </p>
        ) : null}
      </section>

      <div className={styles.status} aria-live="polite">
        {state.status === 'secret' ? (
          <p role="alert" className={`on-pink ${styles.notice}`}>
            {state.message}
          </p>
        ) : null}
        {state.status === 'saved' ||
        state.status === 'reset' ||
        state.status === 'limited' ||
        state.status === 'failed' ? (
          <p
            role={
              state.status === 'saved' || state.status === 'reset'
                ? 'status'
                : 'alert'
            }
            className={`${
              state.status === 'saved' || state.status === 'reset'
                ? 'on-azure'
                : 'on-pink'
            } ${styles.notice}`}
          >
            {MESSAGES[state.status]}
          </p>
        ) : null}
      </div>

      <div className={styles.actions}>
        <button
          type="submit"
          className="button"
          disabled={busy}
          onClick={() => {
            setLast('save')
          }}
        >
          {saving ? 'Saving…' : 'Save voice'}
        </button>
        <button
          type="submit"
          formAction={reset}
          formNoValidate
          className="button button-soft"
          disabled={busy}
          onClick={() => {
            setLast('reset')
          }}
        >
          {resetting ? 'Resetting…' : 'Reset to default'}
        </button>
      </div>
    </form>
  )
}
