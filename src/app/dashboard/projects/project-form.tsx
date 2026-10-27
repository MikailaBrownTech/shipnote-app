'use client'

import Link from 'next/link'
import { useActionState, useId, useState } from 'react'
import {
  countChars,
  PROJECT_LIMITS,
  STAGE_LABELS,
  STAGES,
  type ProjectField,
} from '@/lib/project-schema'
import type { FormValues, ProjectFormState } from './actions'
import styles from './projects.module.css'

type Action = (
  previous: ProjectFormState,
  form: FormData,
) => Promise<ProjectFormState>

// Fixed wording per outcome. Nothing the person typed is ever echoed here.
const notices: Record<Exclude<ProjectFormState['status'], 'idle'>, string> = {
  invalid: 'Check the highlighted fields.',
  limited: 'Too many attempts. Try again in a few minutes.',
  limit: `You have reached the ${String(PROJECT_LIMITS.perUser)} project limit.`,
  failed: 'We could not save your project. Try again.',
}

const number = new Intl.NumberFormat('en')

export function ProjectForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: Action
  initial: FormValues
  submitLabel: string
  cancelHref: string
}) {
  const [state, run, pending] = useActionState(action, {
    status: 'idle',
    errors: {},
    values: null,
  })
  // After a problem the form shows back what was typed, so notes are not lost.
  const values = state.values ?? initial
  const [notesCount, setNotesCount] = useState(() => countChars(values.notes))

  const id = useId()
  const over = notesCount > PROJECT_LIMITS.notes
  const error = (field: ProjectField) => state.errors[field]

  return (
    <form action={run} className={styles.form} noValidate>
      <div className={styles.field}>
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          name="name"
          type="text"
          defaultValue={values.name}
          autoComplete="off"
          required
          aria-invalid={error('name') ? true : undefined}
          aria-describedby={error('name') ? `${id}-name-error` : undefined}
        />
        {error('name') ? (
          <p id={`${id}-name-error`} className={styles.fieldError}>
            {error('name')}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-summary`}>Summary (optional)</label>
        <input
          id={`${id}-summary`}
          name="summary"
          type="text"
          defaultValue={values.summary}
          autoComplete="off"
          aria-invalid={error('summary') ? true : undefined}
          aria-describedby={`${id}-summary-help${error('summary') ? ` ${id}-summary-error` : ''}`}
        />
        <p id={`${id}-summary-help`} className={styles.help}>
          One line, up to {String(PROJECT_LIMITS.summary)} characters.
        </p>
        {error('summary') ? (
          <p id={`${id}-summary-error`} className={styles.fieldError}>
            {error('summary')}
          </p>
        ) : null}
      </div>

      <fieldset className={styles.field}>
        <legend>Stage</legend>
        <div className={styles.stages}>
          {STAGES.map((stage) => (
            <label key={stage} className={styles.stage}>
              <input
                type="radio"
                name="stage"
                value={stage}
                defaultChecked={values.stage === stage}
                required
              />
              {STAGE_LABELS[stage]}
            </label>
          ))}
        </div>
        {error('stage') ? (
          <p className={styles.fieldError}>{error('stage')}</p>
        ) : null}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={`${id}-notes`}>Notes</label>
        <p id={`${id}-notes-help`} className={styles.help}>
          Paste your README, spec or recent progress notes. Keep it to the parts
          you would talk about publicly. Do not paste secrets or customer data.
        </p>
        <textarea
          id={`${id}-notes`}
          name="notes"
          defaultValue={values.notes}
          spellCheck
          onChange={(event) => {
            setNotesCount(countChars(event.currentTarget.value))
          }}
          aria-invalid={error('notes') || over ? true : undefined}
          aria-describedby={`${id}-notes-help ${id}-notes-count${error('notes') ? ` ${id}-notes-error` : ''}`}
        />
        <p
          id={`${id}-notes-count`}
          className={`${styles.counter} ${over ? styles.counterOver : ''}`}
        >
          {number.format(notesCount)} / {number.format(PROJECT_LIMITS.notes)}
          {over
            ? ` (${number.format(notesCount - PROJECT_LIMITS.notes)} over)`
            : ''}
        </p>
        {error('notes') ? (
          <p id={`${id}-notes-error`} className={styles.fieldError}>
            {error('notes')}
          </p>
        ) : null}
      </div>

      <div className={styles.actions}>
        <button type="submit" className="button" disabled={pending}>
          {submitLabel}
        </button>
        <Link href={cancelHref} className="button button-soft">
          Cancel
        </Link>
      </div>

      <p
        role="alert"
        className={`${styles.status} ${state.status === 'idle' ? '' : 'on-pink'}`}
      >
        {state.status === 'idle' ? null : notices[state.status]}
      </p>
    </form>
  )
}
