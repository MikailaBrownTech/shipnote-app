'use client'

import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'
import type { DraftWarning } from '@/lib/draft-checker'
import { countWords, WORD_RANGE } from '@/lib/draft-rules'
import { TONE_IDS, TONES, type ToneId } from '@/lib/voice-tones'
import { Icon } from '../icons'
import { LinkedinPreview } from '../linkedin-preview'
import {
  copyDraftAction,
  discardDraftAction,
  generateDraftAction,
  saveDraftAction,
  type EditState,
  type GenerateState,
} from './draft-actions'
import { checkCommitsAction, type CommitState } from './github-actions'
import { AutoDraftCard, type AutoJobView } from './auto-draft-controls'
import styles from './drafts.module.css'
import { NotesFlag } from './notes-flag'
import {
  ScheduledPostsList,
  ScheduleSection,
  type ConnectionState,
  type ScheduleView,
} from './schedule-controls'

// The Drafts tab. Everything shown is plain text: the model's draft sits in a
// text area (never as markup), commit titles are text, and every message is
// fixed wording chosen by a code from the server. Nothing is sent, posted or
// scheduled: the person copies the text and posts it themselves.

const DAILY_LIMIT = 10
const MAX_COMMITS = 5

// Scheduling through Buffer, present only while it is on.
export type SchedulingView = {
  connection: ConnectionState
  // The active schedule of each draft, by draft id.
  byDraft: Record<string, ScheduleView>
  // The project's schedules, newest first.
  posts: (ScheduleView & { body: string })[]
}

export type DraftView = {
  id: string
  body: string
  status: 'draft' | 'copied'
  createdAt: string
  // Written by a push, not by the Generate button.
  auto?: boolean
}

// The automatic drafts switch and its skipped or failed jobs, present only while
// automatic drafts are on.
export type AutoView = {
  enabled: boolean
  canEnable: boolean
  jobs: AutoJobView[]
}

const REFUSALS: Record<
  Extract<GenerateState, { status: 'refused' }>['reason'],
  string
> = {
  no_content: 'Pick a commit or write a note first.',
  github:
    'Shipnote could not read your repository. Check the GitHub tab, or write a note instead.',
  commit_not_found:
    'One of those commits is not in the last 30 days of [post] commits. Check for commits again.',
  secret:
    'That text looks like it contains a secret, so nothing was sent. Remove it and try again.',
  voice_secret:
    'Your voice settings look like they contain a secret, so nothing was sent. Open Voice, remove it and try again.',
  daily_limit: "You have used today's 10 drafts. Try again tomorrow (UTC).",
  monthly_cap:
    'Drafting is paused for this month. You can still write and edit posts yourself.',
  provider:
    'The drafting service is not responding. Nothing was used. Try again in a moment.',
  invalid_output:
    'The draft did not pass our checks, so it was thrown away. That counted as one of today’s drafts. Try again.',
  failed: 'Something went wrong. Try again.',
}

const EDIT_MESSAGES: Record<Exclude<EditState['status'], 'ok'>, string> = {
  invalid: 'The draft must be between 1 and 3,000 characters.',
  limited: 'Too many changes. Try again in a few minutes.',
  not_found: 'That draft no longer exists.',
  failed: 'Something went wrong. Try again.',
}

const idle: GenerateState = { status: 'idle' }
const idleCommits: CommitState = { status: 'idle' }

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : `${dateFormat.format(date)} UTC`
}

function Warnings({ warnings }: { warnings: DraftWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className={styles.warnings}>
      <p className={styles.warningsTitle}>Check before you post</p>
      <ul>
        {warnings.map((warning) => (
          <li key={warning.code}>{warning.message}</li>
        ))}
      </ul>
    </div>
  )
}

// One draft in an editable text area. Used for the draft just written and for
// each draft in the recent list.
function DraftEditor({
  projectId,
  draft,
  warnings: initialWarnings,
  onGone,
  scheduling,
}: {
  projectId: string
  draft: DraftView
  warnings: DraftWarning[]
  onGone: (id: string) => void
  scheduling: SchedulingView | null
}) {
  const [body, setBody] = useState(draft.body)
  const [warnings, setWarnings] = useState(initialWarnings)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(draft.status === 'copied')
  const [pending, start] = useTransition()
  const words = countWords(body)

  function report(result: EditState, done: string) {
    if (result.status === 'ok') {
      setMessage(done)
      return true
    }
    setMessage(EDIT_MESSAGES[result.status])
    if (result.status === 'not_found') onGone(draft.id)
    return false
  }

  function save() {
    start(async () => {
      const result = await saveDraftAction(draft.id, projectId, body)
      if (report(result, 'Saved.') && result.status === 'ok') {
        setWarnings(result.warnings)
      }
    })
  }

  function copy() {
    start(async () => {
      // Copy first, while the click still counts as the person's action.
      try {
        await navigator.clipboard.writeText(body)
      } catch {
        setMessage('Could not copy. Select the text and copy it yourself.')
        return
      }
      const result = await copyDraftAction(draft.id, projectId, body)
      if (
        report(result, 'Copied. Paste it into LinkedIn and post it yourself.')
      ) {
        setCopied(true)
      }
    })
  }

  function discard() {
    start(async () => {
      const result = await discardDraftAction(draft.id, projectId)
      if (result.status === 'ok' || result.status === 'not_found') {
        onGone(draft.id)
      } else {
        setMessage(EDIT_MESSAGES[result.status])
      }
    })
  }

  const label = `Draft from ${formatDate(draft.createdAt)}`
  return (
    <div className={styles.editor}>
      <label htmlFor={`draft-${draft.id}`} className={styles.editorLabel}>
        {label}
        {draft.auto ? <span className={styles.tag}>Auto</span> : null}
        {copied ? <span className={styles.tag}>Copied</span> : null}
      </label>
      <textarea
        id={`draft-${draft.id}`}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
        }}
        maxLength={3000}
        rows={12}
        spellCheck
      />
      <p className={styles.counter}>
        {words} word{words === 1 ? '' : 's'}
        <span
          className={
            words < WORD_RANGE.min || words > WORD_RANGE.max
              ? styles.counterOff
              : undefined
          }
        >
          {' '}
          (aim for {WORD_RANGE.min} to {WORD_RANGE.max})
        </span>
      </p>
      <Warnings warnings={warnings} />
      <details className={styles.previewBox}>
        <summary>Preview on LinkedIn</summary>
        <LinkedinPreview body={body} />
      </details>
      <div className={styles.buttons}>
        <button
          type="button"
          className="button"
          onClick={copy}
          disabled={pending || body.trim() === ''}
        >
          <Icon name="copy" size={18} />
          Copy
        </button>
        <button
          type="button"
          className="button button-soft"
          onClick={save}
          disabled={pending || body.trim() === ''}
        >
          Save changes
        </button>
        <button
          type="button"
          className="button button-soft"
          onClick={discard}
          disabled={pending}
        >
          <Icon name="trash" size={18} />
          Discard
        </button>
      </div>
      <p className={styles.help} role="status" aria-live="polite">
        {message}
      </p>
      {scheduling ? (
        <ScheduleSection
          key={draft.id}
          projectId={projectId}
          draftId={draft.id}
          connection={scheduling.connection}
          active={scheduling.byDraft[draft.id] ?? null}
        />
      ) : null}
    </div>
  )
}

export function DraftWorkshop({
  projectId,
  canUseCommits,
  initialLeft,
  covered,
  recent,
  scheduling,
  auto,
  savedTone,
}: {
  projectId: string
  // A repository is linked and connected.
  canUseCommits: boolean
  // Drafts left today, or null if that could not be read.
  initialLeft: number | null
  // Full shas of commits already in a copied draft.
  covered: string[]
  recent: DraftView[]
  // null while scheduling is off.
  scheduling: SchedulingView | null
  // null while automatic drafts are off.
  auto: AutoView | null
  // The user's saved tone, or null if it could not be read.
  savedTone: ToneId | null
}) {
  const [commitState, checkCommits, checking] = useActionState(
    checkCommitsAction.bind(null, projectId),
    idleCommits,
  )
  const [state, generate, generating] = useActionState(
    generateDraftAction.bind(null, projectId),
    idle,
  )
  const [gone, setGone] = useState<string[]>([])
  // Which commits are ticked, by short sha. Null until the person changes
  // something: then the default applies (uncovered commits ticked, up to five).
  const [ticked, setTicked] = useState<string[] | null>(null)

  const commits = commitState.status === 'ok' ? commitState.commits : []
  const isCovered = (sha: string) =>
    covered.some((full) => full.startsWith(sha))
  const defaults = commits
    .filter((commit) => !isCovered(commit.sha))
    .slice(0, MAX_COMMITS)
    .map((commit) => commit.sha)
  const selected = ticked ?? defaults

  function toggle(sha: string) {
    setTicked(
      selected.includes(sha)
        ? selected.filter((item) => item !== sha)
        : [...selected, sha],
    )
  }

  const left =
    state.status === 'ok'
      ? state.left
      : state.status === 'refused' && state.left !== null
        ? state.left
        : initialLeft
  const out = left !== null && left <= 0

  const shown = recent.filter(
    (draft) =>
      !gone.includes(draft.id) &&
      !(state.status === 'ok' && state.draft.id === draft.id),
  )

  return (
    <div className={styles.workshop}>
      <section className={`card ${styles.card}`} aria-labelledby="gen-title">
        <h2 id="gen-title">
          <Icon name="bolt" size={20} />
          Write a draft
        </h2>
        <p className={styles.help}>
          Shipnote writes a first draft from your notes and the commits you
          pick. You edit it and post it yourself. Shipnote never posts.
        </p>

        {canUseCommits ? (
          <form action={checkCommits} className={styles.check}>
            <button
              type="submit"
              className="button button-soft"
              disabled={checking}
            >
              <Icon name="check" size={18} />
              {checking ? 'Checking…' : 'Check for [post] commits'}
            </button>
          </form>
        ) : (
          <p className={styles.help}>
            No repository is linked, so you can write from a note alone.
          </p>
        )}

        <div aria-live="polite">
          {commitState.status === 'ok' ? (
            commits.length === 0 ? (
              <p className={styles.help}>
                No commits with [post] in the last 30 days.
              </p>
            ) : (
              <fieldset className={styles.commits}>
                <legend>
                  Commits to use (up to {MAX_COMMITS}). Ticked:{' '}
                  {selected.length}.
                </legend>
                {commits.map((commit) => {
                  const used = isCovered(commit.sha)
                  const on = selected.includes(commit.sha)
                  return (
                    <label key={commit.sha} className={styles.commit}>
                      <input
                        type="checkbox"
                        form="draft-form"
                        name="sha"
                        value={commit.sha}
                        checked={on}
                        disabled={!on && selected.length >= MAX_COMMITS}
                        onChange={() => {
                          toggle(commit.sha)
                        }}
                      />
                      <span className={styles.sha}>{commit.sha}</span>
                      {/* A commit title is untrusted text: plain text only. */}
                      <span className={styles.commitTitle}>{commit.title}</span>
                      {used ? (
                        <span className={styles.tag}>Used in a draft</span>
                      ) : null}
                    </label>
                  )
                })}
              </fieldset>
            )
          ) : commitState.status === 'limited' ? (
            <p role="alert" className={`on-pink ${styles.notice}`}>
              Too many checks. Try again in a few minutes.
            </p>
          ) : commitState.status !== 'idle' &&
            commitState.status !== 'not_found' ? (
            <p role="alert" className={`on-pink ${styles.notice}`}>
              Could not read your commits. Check the GitHub tab, or write a note
              instead.
            </p>
          ) : null}
        </div>

        <form id="draft-form" action={generate} className={styles.form}>
          <label htmlFor="draft-note" className={styles.editorLabel}>
            Note for this post{' '}
            <span className={styles.optional}>(optional)</span>
          </label>
          <textarea
            id="draft-note"
            name="note"
            rows={4}
            maxLength={500}
            placeholder="What should this post be about? What did you learn?"
          />
          <fieldset className={styles.tonePicker}>
            <legend className={styles.editorLabel}>
              Tone for this post{' '}
              <span className={styles.optional}>(optional)</span>
            </legend>
            <div className={styles.toneGrid}>
              <label className={styles.toneCard}>
                <input type="radio" name="tone" value="" defaultChecked />
                <span className={`${styles.toneDot} ${styles.toneSaved}`}>
                  <Icon name="check" size={14} />
                </span>
                <strong>Your saved tone</strong>
                <span className={styles.toneText}>
                  {savedTone
                    ? `Currently ${TONES[savedTone].label}.`
                    : 'Uses the tone you saved on the Voice page.'}
                </span>
              </label>
              {TONE_IDS.map((id) => (
                <label key={id} className={styles.toneCard}>
                  <input type="radio" name="tone" value={id} />
                  <span className={`${styles.toneDot} ${styles[`tone_${id}`]}`}>
                    {TONES[id].label.slice(0, 1)}
                  </span>
                  <strong>{TONES[id].label}</strong>
                  <span className={styles.toneText}>
                    {TONES[id].description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className={styles.help}>
            Only for this draft. It does not change your saved voice.{' '}
            <Link href="/dashboard/settings/voice">Change your voice</Link>
          </p>
          <div className={styles.buttons}>
            <button
              type="submit"
              className="button"
              disabled={generating || out}
            >
              <Icon name="bolt" size={18} />
              {generating ? 'Writing…' : 'Generate draft'}
            </button>
            <span className={styles.left}>
              {left === null
                ? `${String(DAILY_LIMIT)} drafts a day`
                : `${String(left)} of ${String(DAILY_LIMIT)} drafts left today`}
            </span>
          </div>
          <p className={styles.help}>
            Pressing Generate again writes a new draft and uses another of
            today’s drafts.
          </p>
          <NotesFlag projectId={projectId} where="drafts" />
        </form>

        <div aria-live="polite">
          {state.status === 'invalid' ? (
            <p role="alert" className={`on-pink ${styles.notice}`}>
              Check the commits and note, then try again.
            </p>
          ) : null}
          {state.status === 'limited' ? (
            <p role="alert" className={`on-pink ${styles.notice}`}>
              Too many requests. Try again in a few minutes.
            </p>
          ) : null}
          {state.status === 'refused' ? (
            <p role="alert" className={`on-pink ${styles.notice}`}>
              {REFUSALS[state.reason]}
              {state.reason === 'secret' && state.secretKinds?.length
                ? ` Found: ${state.secretKinds.join(', ')}.`
                : ''}
            </p>
          ) : null}
        </div>
      </section>

      {state.status === 'ok' ? (
        <section className={`card ${styles.card}`} aria-labelledby="new-title">
          <h2 id="new-title">
            <Icon name="edit" size={20} />
            Your draft
          </h2>
          <DraftEditor
            key={state.draft.id}
            projectId={projectId}
            draft={{
              id: state.draft.id,
              body: state.draft.body,
              status: 'draft',
              createdAt: new Date().toISOString(),
            }}
            warnings={state.draft.warnings}
            onGone={(id) => {
              setGone((list) => [...list, id])
            }}
            scheduling={scheduling}
          />
        </section>
      ) : null}

      <section className={`card ${styles.card}`} aria-labelledby="recent-title">
        <h2 id="recent-title">
          <Icon name="note" size={20} />
          Recent drafts
        </h2>
        {shown.length === 0 ? (
          <p className={styles.help}>No other drafts yet.</p>
        ) : (
          <ul className={styles.recent}>
            {shown.map((draft) => (
              <li key={draft.id}>
                <details>
                  <summary>
                    {formatDate(draft.createdAt)}
                    {draft.auto ? (
                      <span className={styles.tag}>Auto</span>
                    ) : null}
                    {draft.status === 'copied' ? (
                      <span className={styles.tag}>Copied</span>
                    ) : null}
                  </summary>
                  <DraftEditor
                    projectId={projectId}
                    draft={draft}
                    warnings={[]}
                    onGone={(id) => {
                      setGone((list) => [...list, id])
                    }}
                    scheduling={scheduling}
                  />
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {auto ? (
        <AutoDraftCard
          projectId={projectId}
          enabled={auto.enabled}
          canEnable={auto.canEnable}
          jobs={auto.jobs}
        />
      ) : null}

      {scheduling ? (
        <ScheduledPostsList projectId={projectId} posts={scheduling.posts} />
      ) : null}
    </div>
  )
}
