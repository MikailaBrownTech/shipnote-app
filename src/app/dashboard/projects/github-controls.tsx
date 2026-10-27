'use client'

import { useActionState, useState } from 'react'
import { Icon } from '../icons'
import {
  checkCommitsAction,
  disconnectGithubAction,
  type CommitState,
} from './github-actions'
import styles from './projects.module.css'

const idle: CommitState = { status: 'idle' }

// Fixed wording for every outcome. Nothing from GitHub is shown except the
// commit titles in the list, which are rendered as plain text.
const notices: Record<
  Exclude<CommitState['status'], 'idle' | 'ok' | 'not_found'>,
  string
> = {
  limited: 'Too many checks. Try again in a few minutes.',
  not_linked: 'Choose a repository first.',
  reconnect:
    'Shipnote no longer has access to GitHub. Use Reconnect GitHub to continue.',
  repo_gone:
    'We cannot see that repository any more. Choose another repository, or unlink it.',
  rate_limited:
    'GitHub is limiting requests right now. Try again in a few minutes.',
  unavailable: 'GitHub is not responding. Try again in a moment.',
  failed: 'Something went wrong. Try again.',
}

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatDate(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date)
}

export function CheckCommits({ projectId }: { projectId: string }) {
  const [state, run, pending] = useActionState(
    checkCommitsAction.bind(null, projectId),
    idle,
  )

  return (
    <form action={run} className={styles.githubCheck}>
      <button type="submit" className="button" disabled={pending}>
        <Icon name="check" size={18} />
        {pending ? 'Checking…' : 'Check for [post] commits'}
      </button>

      <div aria-live="polite">
        {state.status === 'ok' ? (
          state.commits.length === 0 ? (
            <p className={styles.help}>
              No commits with [post] in the last 30 days.
            </p>
          ) : (
            <>
              <p className={styles.help}>
                {state.commits.length} commit
                {state.commits.length === 1 ? '' : 's'} with [post] in the last
                30 days.
              </p>
              {/* Commit messages are untrusted text: plain text only. */}
              <ul className={styles.commits}>
                {state.commits.map((commit) => (
                  <li key={commit.sha}>
                    <a
                      href={commit.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {commit.sha}
                    </a>
                    <span className={styles.commitTitle}>{commit.title}</span>
                    {formatDate(commit.date) ? (
                      <time dateTime={commit.date ?? undefined}>
                        {formatDate(commit.date)}
                      </time>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )
        ) : state.status !== 'idle' && state.status !== 'not_found' ? (
          <p role="alert" className={`on-pink ${styles.notice}`}>
            {notices[state.status]}
          </p>
        ) : null}
      </div>
    </form>
  )
}

// Disconnect asks first. It removes the connection in Shipnote only; it does
// not uninstall the App on GitHub.
export function DisconnectGithub({
  projectId,
  installationId,
}: {
  projectId: string
  installationId: number
}) {
  const [confirming, setConfirming] = useState(false)
  const disconnect = disconnectGithubAction.bind(null, projectId)

  if (!confirming) {
    return (
      <button
        type="button"
        className="button button-soft"
        onClick={() => {
          setConfirming(true)
        }}
      >
        Disconnect GitHub
      </button>
    )
  }

  return (
    <form action={disconnect} className={`on-pink ${styles.confirm}`}>
      <p>
        Disconnect GitHub from Shipnote? This removes the connection here, for
        all your projects. It does not uninstall the app on GitHub; you can do
        that at github.com/settings/installations.
      </p>
      <input type="hidden" name="installation" value={String(installationId)} />
      <div className={styles.confirmActions}>
        <button type="submit" className="button button-dark">
          Yes, disconnect
        </button>
        <button
          type="button"
          className="button button-light"
          onClick={() => {
            setConfirming(false)
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
