import { STAGE_LABELS, type Stage } from '@/lib/project-schema'

const tones: Record<Stage, string> = {
  idea: 'on-amber',
  in_progress: 'on-azure',
  shipped: 'on-violet',
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`pill ${tones[stage]}`}>{STAGE_LABELS[stage]}</span>
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
