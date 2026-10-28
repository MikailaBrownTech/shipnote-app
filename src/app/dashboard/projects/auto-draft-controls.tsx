'use client'

import { useActionState } from 'react'
import { jobReason } from '@/lib/auto-draft-job'
import { Icon } from '../icons'
import { setAutoDraftAction, type AutoDraftState } from './auto-draft-actions'
import styles from './drafts.module.css'

// The automatic drafts switch for one project, and the jobs that did not make a
// draft. Plain text only: a job is a short sha and a reason from a fixed list,
// never any commit text.

export type AutoJobView = {
  id: string
  commitSha: string
  status: 'queued' | 'running' | 'done' | 'skipped' | 'failed'
  reason: string | null
  createdAt: string
}

const STATUS_WORDS: Record<AutoJobView['status'], string> = {
  queued: 'Waiting',
  running: 'Writing',
  done: 'Drafted',
  skipped: 'Skipped',
  failed: 'Failed',
}

const MESSAGES: Record<
  Exclude<AutoDraftState['status'], 'idle' | 'ok'>,
  string
> = {
  invalid: 'Something went wrong. Try again.',
  limited: 'Too many changes. Try again in a few minutes.',
  no_repo: 'Link a repository on the GitHub tab first.',
  failed: 'Something went wrong. Try again.',
}

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : `${dateFormat.format(date)} UTC`
}

export function AutoDraftCard({
  projectId,
  enabled,
  canEnable,
  jobs,
}: {
  projectId: string
  enabled: boolean
  // A repository is linked and connected.
  canEnable: boolean
  jobs: AutoJobView[]
}) {
  const [state, run, pending] = useActionState(
    setAutoDraftAction.bind(null, projectId),
    { status: 'idle' } as AutoDraftState,
  )
  const on = state.status === 'ok' ? state.on : enabled
  const shown = jobs.filter(
    (job) => job.status === 'skipped' || job.status === 'failed',
  )

  return (
    <section className={`card ${styles.card}`} aria-labelledby="auto-title">
      <h2 id="auto-title">
        <Icon name="bolt" size={20} />
        Automatic drafts
      </h2>
      <p className={styles.help}>
        Draft automatically when I push a commit with <code>[post]</code>. Off
        by default.
      </p>
      <ul className={styles.autoFacts}>
        <li>
          Only the commit message is used, along with your project name, summary
          and notes. No code or diffs are read.
        </li>
        <li>
          Each automatic draft uses one of your 10 drafts for the day, and your
          monthly cap. When the day is used up, new commits are skipped, not
          queued for later.
        </li>
        <li>
          You still edit and post it yourself. Shipnote never posts, and
          automatic drafts are tagged Auto.
        </li>
        <li>
          Only pushes to the default branch count. Merge commits are skipped.
        </li>
      </ul>

      <form action={run} className={styles.buttons}>
        <input type="hidden" name="on" value={on ? 'false' : 'true'} />
        <button
          type="submit"
          className={on ? 'button button-soft' : 'button'}
          disabled={pending || (!on && !canEnable)}
        >
          {pending
            ? 'Saving…'
            : on
              ? 'Turn off automatic drafts'
              : 'Turn on automatic drafts'}
        </button>
        <span className={styles.left} role="status" aria-live="polite">
          {on ? 'On' : 'Off'}
        </span>
      </form>
      {!on && !canEnable ? (
        <p className={styles.help}>
          Link a repository on the GitHub tab to turn this on.
        </p>
      ) : null}
      {state.status !== 'idle' && state.status !== 'ok' ? (
        <p role="alert" className={`on-pink ${styles.notice}`}>
          {MESSAGES[state.status]}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <div>
          <h3 className={styles.subhead}>Commits that did not make a draft</h3>
          <ul className={styles.recent}>
            {shown.map((job) => (
              <li key={job.id} className={styles.scheduledItem}>
                <p>
                  <strong>{STATUS_WORDS[job.status]}</strong>{' '}
                  <code>{job.commitSha.slice(0, 7)}</code>{' '}
                  <span className={styles.help}>
                    {formatDate(job.createdAt)}
                  </span>
                </p>
                <p className={styles.help}>{jobReason(job.reason)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
