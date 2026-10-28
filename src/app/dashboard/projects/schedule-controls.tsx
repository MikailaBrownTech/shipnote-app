'use client'

import { useActionState, useState, useTransition } from 'react'
import { Icon } from '../icons'
import { LinkedinPreview } from '../linkedin-preview'
import {
  cancelScheduleAction,
  confirmScheduleAction,
  connectBufferAction,
  refreshStatusAction,
  startReviewAction,
  type ConfirmState,
  type ReviewState,
} from '../buffer/actions'
import styles from './drafts.module.css'

// Scheduling a draft on LinkedIn through the person's own Buffer account.
// Everything shown is plain text with fixed wording chosen by a code from the
// server. The review step shows the exact saved text, the channel and the time;
// nothing is scheduled until the person presses Confirm.

export type ConnectionState = 'none' | 'connected' | 'needs_reconnect'

export type ScheduleView = {
  id: string
  scheduledFor: string
  channelLabel: string | null
  status: 'scheduling' | 'scheduled' | 'canceled' | 'failed' | 'published'
  failureCode: string | null
}

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export function formatWhen(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : `${dateFormat.format(date)} UTC`
}

const REVIEW_MESSAGES: Record<Exclude<ReviewState['status'], 'ok'>, string> = {
  not_found: 'That draft no longer exists.',
  limited: 'Too many attempts. Try again in a few minutes.',
  needs_reconnect: 'Buffer needs to be connected again.',
  rate_limited:
    'Buffer is limiting requests right now. Try again in a few minutes.',
  unavailable:
    'Buffer is not responding. Nothing was scheduled. Try again in a moment.',
  no_channels:
    'No LinkedIn channel was found in your Buffer account. Add one in Buffer, then try again.',
  failed: 'Something went wrong. Nothing was scheduled.',
}

const REFUSALS: Record<
  Extract<ConfirmState, { status: 'refused' }>['reason'],
  string
> = {
  not_found: 'That draft no longer exists.',
  invalid_time: 'Choose a valid date and time.',
  too_soon: 'Choose a time at least 10 minutes from now.',
  too_far: 'Choose a time no more than 30 days from now.',
  text_changed:
    'The draft changed after you opened this review. Nothing was scheduled. Open the review again.',
  channel: 'That channel is not one of your LinkedIn channels in Buffer.',
  needs_reconnect: 'Buffer needs to be connected again. Nothing was scheduled.',
  daily_limit: 'You have scheduled 5 posts today. Try again tomorrow (UTC).',
  already_scheduled: 'This draft is already scheduled.',
  rate_limited:
    'Buffer is limiting requests right now. Nothing was scheduled. Try again in a few minutes.',
  plan_limit:
    'Your Buffer plan or channel limit has been reached. Nothing was scheduled.',
  rejected: 'Buffer would not accept this post. Nothing was scheduled.',
  unavailable: 'Buffer is not responding. Nothing was scheduled.',
  unknown_result:
    'We could not confirm whether Buffer scheduled this. Check Buffer before trying again. Shipnote will not retry on its own.',
  failed: 'Something went wrong. Check Buffer before trying again.',
}

const CANCEL_MESSAGES: Partial<Record<string, string>> = {
  canceled: 'Cancelled. Buffer will not publish it.',
  published: 'Buffer already published this post, so it cannot be cancelled.',
  not_active: 'This schedule has already ended.',
  in_progress: 'This is still being scheduled. Check Buffer before cancelling.',
  needs_reconnect:
    'Buffer needs to be connected again before this can be cancelled.',
  rate_limited:
    'Buffer is limiting requests right now. Try again in a few minutes.',
  unavailable: 'Buffer is not responding. It was not cancelled. Try again.',
  failed: 'It could not be cancelled. Cancel it in Buffer.',
  limited: 'Too many attempts. Try again in a few minutes.',
  not_found: 'That schedule no longer exists.',
}

const cancelText = (code: string) =>
  CANCEL_MESSAGES[code] ?? 'It could not be cancelled. Cancel it in Buffer.'

const STATUS_LABELS: Record<ScheduleView['status'], string> = {
  scheduling: 'Being scheduled',
  scheduled: 'Scheduled',
  canceled: 'Cancelled',
  failed: 'Failed',
  published: 'Published',
}

// The Connect / Reconnect Buffer button, remembering where the person was.
export function ConnectBuffer({
  projectId,
  draftId,
  reconnect,
}: {
  projectId: string
  draftId: string | null
  reconnect: boolean
}) {
  return (
    <form action={connectBufferAction}>
      <input type="hidden" name="project" value={projectId} />
      {draftId ? <input type="hidden" name="draft" value={draftId} /> : null}
      <button type="submit" className="button button-soft">
        <Icon name="arrowRight" size={18} />
        {reconnect ? 'Reconnect Buffer' : 'Connect Buffer'}
      </button>
    </form>
  )
}

// The schedule part of one draft.
export function ScheduleSection({
  projectId,
  draftId,
  connection,
  active: initialActive,
}: {
  projectId: string
  draftId: string
  connection: ConnectionState
  active: ScheduleView | null
}) {
  const [active, setActive] = useState(initialActive)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function open() {
    setMessage(null)
    start(async () => {
      const result = await startReviewAction(projectId, draftId)
      if (result.status === 'ok') setReview(result)
      else setMessage(REVIEW_MESSAGES[result.status])
    })
  }

  function cancel() {
    if (!active) return
    start(async () => {
      const result = await cancelScheduleAction(projectId, active.id)
      if (result.status !== 'ok') {
        setMessage(cancelText(result.status))
        return
      }
      setMessage(cancelText(result.result))
      if (result.result === 'canceled') setActive(null)
      if (result.result === 'published') {
        setActive({ ...active, status: 'published' })
      }
    })
  }

  if (
    active &&
    (active.status === 'scheduled' || active.status === 'scheduling')
  ) {
    return (
      <div className={styles.schedule}>
        <p>
          <strong>
            {active.status === 'scheduled' ? 'Scheduled' : 'Being scheduled'}{' '}
            for {formatWhen(active.scheduledFor)}
          </strong>
          {active.channelLabel ? ` on ${active.channelLabel}` : ''}
        </p>
        <p className={styles.help}>
          Editing this draft later does not change the scheduled text. To change
          what is posted, cancel and schedule again.
        </p>
        <div className={styles.buttons}>
          <button
            type="button"
            className="button button-soft"
            onClick={cancel}
            disabled={pending || active.status !== 'scheduled'}
          >
            Cancel schedule
          </button>
        </div>
        <p className={styles.help} role="status" aria-live="polite">
          {message}
        </p>
      </div>
    )
  }

  if (active?.status === 'published') {
    return (
      <div className={styles.schedule}>
        <p>
          <strong>Published by Buffer</strong> on{' '}
          {formatWhen(active.scheduledFor)}
        </p>
      </div>
    )
  }

  if (connection === 'none' || connection === 'needs_reconnect') {
    return (
      <div className={styles.schedule}>
        <p className={styles.help}>
          {connection === 'needs_reconnect'
            ? 'Buffer needs to be connected again to schedule posts.'
            : 'Connect your Buffer account to schedule this draft on LinkedIn.'}
        </p>
        <ConnectBuffer
          projectId={projectId}
          draftId={draftId}
          reconnect={connection === 'needs_reconnect'}
        />
      </div>
    )
  }

  if (review?.status === 'ok') {
    return (
      <ReviewForm
        projectId={projectId}
        review={review}
        onClose={() => {
          setReview(null)
        }}
        onScheduled={(id, scheduledFor, channelLabel) => {
          setReview(null)
          setActive({
            id,
            scheduledFor,
            channelLabel,
            status: 'scheduled',
            failureCode: null,
          })
        }}
      />
    )
  }

  return (
    <div className={styles.schedule}>
      <div className={styles.buttons}>
        <button
          type="button"
          className="button button-soft"
          onClick={open}
          disabled={pending}
        >
          <Icon name="rocket" size={18} />
          Schedule on LinkedIn
        </button>
      </div>
      <p className={styles.help} role="status" aria-live="polite">
        {message}
      </p>
    </div>
  )
}

function ReviewForm({
  projectId,
  review,
  onClose,
  onScheduled,
}: {
  projectId: string
  review: Extract<ReviewState, { status: 'ok' }>
  onClose: () => void
  onScheduled: (
    id: string,
    scheduledFor: string,
    channelLabel: string | null,
  ) => void
}) {
  const [state, confirm, pending] = useActionState(
    async (previous: ConfirmState, form: FormData) => {
      const result = await confirmScheduleAction(
        projectId,
        review.draftId,
        previous,
        form,
      )
      if (result.status === 'scheduled') {
        const channel = form.get('channel')
        const label =
          review.channels.find((c) => c.id === channel)?.label ?? null
        onScheduled(result.id, result.scheduledFor, label)
      }
      return result
    },
    { status: 'idle' } as ConfirmState,
  )
  // Only rendered after a click, so this never runs on the server.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const id = `review-${review.draftId}`

  return (
    <form
      action={confirm}
      className={styles.review}
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`}>Review before scheduling</h3>
      <p className={styles.help}>
        This is the exact text that will be sent to Buffer. It is the saved
        draft, so save your changes first if you edited it. Nothing is scheduled
        until you press Confirm.
      </p>

      <label htmlFor={`${id}-text`} className={styles.editorLabel}>
        Text
      </label>
      <textarea id={`${id}-text`} readOnly value={review.text} rows={10} />

      <p className={styles.editorLabel}>How it will look on LinkedIn</p>
      <LinkedinPreview body={review.text} />

      {review.warnings.length > 0 ? (
        <div className={styles.warnings}>
          <p className={styles.warningsTitle}>Check before you post</p>
          <ul>
            {review.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <label htmlFor={`${id}-channel`} className={styles.editorLabel}>
        LinkedIn channel
      </label>
      <select id={`${id}-channel`} name="channel" required defaultValue="">
        <option value="" disabled>
          Choose a channel
        </option>
        {review.channels.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.label}
          </option>
        ))}
      </select>

      <label htmlFor={`${id}-time`} className={styles.editorLabel}>
        Date and time ({timeZone})
      </label>
      <input id={`${id}-time`} type="datetime-local" name="local" required />
      <p className={styles.help}>
        Between 10 minutes and 30 days from now, in your own time zone.
      </p>
      <input type="hidden" name="timezone" value={timeZone} />
      <input type="hidden" name="hash" value={review.hash} />

      <div className={styles.buttons}>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Scheduling…' : 'Confirm and schedule'}
        </button>
        <button
          type="button"
          className="button button-soft"
          onClick={onClose}
          disabled={pending}
        >
          Back
        </button>
      </div>

      <div aria-live="polite">
        {state.status === 'invalid' ? (
          <p role="alert" className={`on-pink ${styles.notice}`}>
            Choose a channel and a date and time.
          </p>
        ) : null}
        {state.status === 'limited' ? (
          <p role="alert" className={`on-pink ${styles.notice}`}>
            Too many attempts. Try again in a few minutes.
          </p>
        ) : null}
        {state.status === 'refused' ? (
          <p role="alert" className={`on-pink ${styles.notice}`}>
            {REFUSALS[state.reason]}
          </p>
        ) : null}
      </div>
    </form>
  )
}

// The project's schedules, newest first, with a Refresh status button.
export function ScheduledPostsList({
  projectId,
  posts,
}: {
  projectId: string
  posts: (ScheduleView & { body: string })[]
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function refresh() {
    setMessage(null)
    start(async () => {
      const result = await refreshStatusAction(projectId)
      if (result.status === 'ok') {
        setMessage(
          result.updated === 0
            ? 'No changes at Buffer.'
            : `Updated ${String(result.updated)} post${result.updated === 1 ? '' : 's'}. Reload to see them.`,
        )
      } else if (result.status === 'needs_reconnect') {
        setMessage('Buffer needs to be connected again.')
      } else if (result.status === 'rate_limited') {
        setMessage(
          'Buffer is limiting requests right now. Try again in a few minutes.',
        )
      } else if (result.status === 'limited') {
        setMessage('Too many refreshes. Try again in a few minutes.')
      } else {
        setMessage('Buffer is not responding. Try again in a moment.')
      }
    })
  }

  return (
    <section
      className={`card ${styles.card}`}
      aria-labelledby="scheduled-title"
    >
      <h2 id="scheduled-title">
        <Icon name="rocket" size={20} />
        Scheduled posts
      </h2>
      {posts.length === 0 ? (
        <p className={styles.help}>Nothing scheduled for this project yet.</p>
      ) : (
        <ul className={styles.recent}>
          {posts.map((post) => (
            <li key={post.id} className={styles.scheduledItem}>
              <p>
                <strong>{STATUS_LABELS[post.status]}</strong> for{' '}
                {formatWhen(post.scheduledFor)}
                {post.channelLabel ? ` on ${post.channelLabel}` : ''}
              </p>
              {post.status === 'failed' ? (
                <p className={styles.help}>
                  {post.failureCode === 'unknown_result' ||
                  post.failureCode === 'record_failed'
                    ? 'We could not confirm whether Buffer scheduled this. Check Buffer.'
                    : 'This was not scheduled.'}
                </p>
              ) : null}
              {/* The snapshot that was sent: plain text. */}
              <p className={styles.snapshot}>{post.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.buttons}>
        <button
          type="button"
          className="button button-soft"
          onClick={refresh}
          disabled={pending}
        >
          {pending ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>
      <p className={styles.help} role="status" aria-live="polite">
        {message}
      </p>
    </section>
  )
}
