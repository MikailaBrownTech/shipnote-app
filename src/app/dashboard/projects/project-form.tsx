'use client'

import Link from 'next/link'
import { useActionState, useId, useState, type ReactNode } from 'react'
import {
  countChars,
  PROJECT_LIMITS,
  STAGE_LABELS,
  STAGES,
  type ProjectField,
  type Stage,
} from '@/lib/project-schema'
import { Icon, type IconName } from '../icons'
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
  repo: 'That repository cannot be used. Choose it again with Start from a GitHub repo, or clear it and save without one.',
  repo_taken: 'That repository is already linked to another of your projects.',
  repo_unavailable: 'GitHub is not responding. Try again in a moment.',
}

const stageInfo: Record<Stage, { icon: IconName; blurb: string }> = {
  idea: { icon: 'bulb', blurb: 'Planning, researching, or early development.' },
  in_progress: {
    icon: 'gear',
    blurb: 'Actively building and making updates.',
  },
  shipped: { icon: 'rocket', blurb: 'Released and available to the world.' },
}

const number = new Intl.NumberFormat('en')

// A form row: a coloured icon tile, then the label, help text and input.
function Row({
  icon,
  tone,
  as: Tag = 'div',
  children,
}: {
  icon: IconName
  tone: string
  as?: 'div' | 'fieldset'
  children: ReactNode
}) {
  return (
    <Tag className={styles.fieldRow}>
      <span className={`${styles.fieldIcon} ${tone}`}>
        <Icon name={icon} size={22} />
      </span>
      <div className={styles.fieldBody}>{children}</div>
    </Tag>
  )
}

export function ProjectForm({
  action,
  initial,
  submitLabel,
  cancelHref,
  github,
}: {
  action: Action
  initial: FormValues
  submitLabel: string
  cancelHref: string
  // The repository this project is being started from, if any. Sent as two
  // hidden fields that the server checks again before saving.
  github?: { installationId: number; repoFullName: string }
}) {
  const [state, run, pending] = useActionState(action, {
    status: 'idle',
    errors: {},
    values: null,
  })
  // After a problem the form shows back what was typed, so notes are not lost.
  const values = state.values ?? initial
  const [summaryCount, setSummaryCount] = useState(() =>
    countChars(values.summary),
  )
  const [notesCount, setNotesCount] = useState(() => countChars(values.notes))

  const id = useId()
  const notesOver = notesCount > PROJECT_LIMITS.notes
  const summaryOver = summaryCount > PROJECT_LIMITS.summary
  const error = (field: ProjectField) => state.errors[field]

  return (
    <form action={run} className={styles.form} noValidate>
      {github ? (
        <>
          <input
            type="hidden"
            name="github_installation"
            value={String(github.installationId)}
          />
          <input type="hidden" name="github_repo" value={github.repoFullName} />
        </>
      ) : null}
      <Row icon="note" tone={styles.tonePurple}>
        <label htmlFor={`${id}-name`}>
          Project name{' '}
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        </label>
        <p id={`${id}-name-help`} className={styles.help}>
          Give your project a clear, recognizable name.
        </p>
        <input
          id={`${id}-name`}
          name="name"
          type="text"
          defaultValue={values.name}
          placeholder="e.g. acme-web-app"
          autoComplete="off"
          required
          aria-invalid={error('name') ? true : undefined}
          aria-describedby={`${id}-name-help${error('name') ? ` ${id}-name-error` : ''}`}
        />
        {error('name') ? (
          <p id={`${id}-name-error`} className={styles.fieldError}>
            {error('name')}
          </p>
        ) : null}
      </Row>

      <Row icon="edit" tone={styles.tonePink}>
        <label htmlFor={`${id}-summary`}>
          Summary <span className={styles.optional}>(optional)</span>
        </label>
        <p id={`${id}-summary-help`} className={styles.help}>
          One line summary of what this project is about. Up to{' '}
          {String(PROJECT_LIMITS.summary)} characters.
        </p>
        <textarea
          id={`${id}-summary`}
          name="summary"
          rows={2}
          defaultValue={values.summary}
          placeholder="e.g. A modern web app built with Next.js and Supabase."
          onChange={(event) => {
            setSummaryCount(countChars(event.currentTarget.value))
          }}
          aria-invalid={error('summary') || summaryOver ? true : undefined}
          aria-describedby={`${id}-summary-help ${id}-summary-count${error('summary') ? ` ${id}-summary-error` : ''}`}
        />
        <p
          id={`${id}-summary-count`}
          className={`${styles.counter} ${summaryOver ? styles.counterOver : ''}`}
        >
          {number.format(summaryCount)} /{' '}
          {number.format(PROJECT_LIMITS.summary)}
        </p>
        {error('summary') ? (
          <p id={`${id}-summary-error`} className={styles.fieldError}>
            {error('summary')}
          </p>
        ) : null}
      </Row>

      <Row icon="chart" tone={styles.toneTeal} as="fieldset">
        <legend>
          Stage{' '}
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        </legend>
        <p className={styles.help}>What stage is this project in?</p>
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
              <span className={styles.stageIcon}>
                <Icon name={stageInfo[stage].icon} size={20} />
              </span>
              <span className={styles.stageText}>
                <strong>{STAGE_LABELS[stage]}</strong>
                <span>{stageInfo[stage].blurb}</span>
              </span>
            </label>
          ))}
        </div>
        {error('stage') ? (
          <p className={styles.fieldError}>{error('stage')}</p>
        ) : null}
      </Row>

      <Row icon="book" tone={styles.toneBlue}>
        <label htmlFor={`${id}-notes`}>
          Notes <span className={styles.optional}>(optional)</span>
        </label>
        <p id={`${id}-notes-help`} className={styles.help}>
          Paste your README, spec or recent progress notes. Keep it to the parts
          you would talk about publicly. Do not paste secrets or customer data.
        </p>
        <textarea
          id={`${id}-notes`}
          name="notes"
          defaultValue={values.notes}
          placeholder="Add any relevant details, goals, or context…"
          spellCheck
          onChange={(event) => {
            setNotesCount(countChars(event.currentTarget.value))
          }}
          aria-invalid={error('notes') || notesOver ? true : undefined}
          aria-describedby={`${id}-notes-help ${id}-notes-count${error('notes') ? ` ${id}-notes-error` : ''}`}
        />
        <p
          id={`${id}-notes-count`}
          className={`${styles.counter} ${notesOver ? styles.counterOver : ''}`}
        >
          {number.format(notesCount)} / {number.format(PROJECT_LIMITS.notes)}
          {notesOver
            ? ` (${number.format(notesCount - PROJECT_LIMITS.notes)} over)`
            : ''}
        </p>
        {error('notes') ? (
          <p id={`${id}-notes-error`} className={styles.fieldError}>
            {error('notes')}
          </p>
        ) : null}
      </Row>

      <p
        role="alert"
        className={`${styles.status} ${state.status === 'idle' ? '' : 'on-pink'}`}
      >
        {state.status === 'idle' ? null : notices[state.status]}
      </p>

      <div className={styles.actions}>
        <Link href={cancelHref} className="button button-soft">
          Cancel
        </Link>
        <button type="submit" className="button" disabled={pending}>
          {submitLabel}
          <Icon name="arrowRight" size={18} />
        </button>
      </div>
    </form>
  )
}
