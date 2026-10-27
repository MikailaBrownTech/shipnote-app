import { STAGE_LABELS, type Stage } from '@/lib/project-schema'
import styles from './projects.module.css'

const tones: Record<Stage, string> = {
  idea: styles.idea,
  in_progress: styles.inProgress,
  shipped: styles.shipped,
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`pill ${styles.badge} ${tones[stage]}`}>
      {STAGE_LABELS[stage]}
    </span>
  )
}

// Rendered in UTC so the server and any later client render agree.
const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

export function Updated({ iso }: { iso: string }) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return (
    <span>
      Updated <time dateTime={iso}>{dateFormat.format(date)}</time>
    </span>
  )
}

// A plain date, in UTC like the rest. null for a value that is not a date.
export function DateText({ iso }: { iso: string }) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return <time dateTime={iso}>{dateFormat.format(date)}</time>
}
