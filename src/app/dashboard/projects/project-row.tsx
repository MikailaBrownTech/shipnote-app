import Link from 'next/link'
import type { Stage } from '@/lib/project-schema'
import { Icon, type IconName } from '../icons'
import styles from './projects.module.css'
import { StageBadge, Updated } from './stage-badge'

// One project in a list: an icon for its stage, the name as the link, a short
// summary, the stage and when it changed. Used by the dashboard and the
// Projects page. All text is shown as text.

const stageIcons: Record<Stage, IconName> = {
  idea: 'bulb',
  in_progress: 'bolt',
  shipped: 'rocket',
}

const stageTones: Record<Stage, string> = {
  idea: styles.idea,
  in_progress: styles.inProgress,
  shipped: styles.shipped,
}

export function ProjectRow({
  project,
  repo = false,
}: {
  project: {
    id: string
    name: string
    summary: string | null
    stage: Stage
    updatedAt: string
    repoFullName?: string | null
  }
  // Also say which repository the project is linked to.
  repo?: boolean
}) {
  return (
    <li className={styles.row}>
      <span
        className={`${styles.rowIcon} ${styles.iconTone} ${stageTones[project.stage]}`}
      >
        <Icon name={stageIcons[project.stage]} />
      </span>
      <div className={styles.rowBody}>
        <h3>
          <Link href={`/dashboard/projects/${project.id}`}>{project.name}</Link>
        </h3>
        {project.summary ? (
          <p className={styles.rowSummary}>{project.summary}</p>
        ) : null}
        {repo ? (
          <p className={styles.rowSummary}>
            <Icon name="github" size={14} />{' '}
            {project.repoFullName ?? 'No repository linked'}
          </p>
        ) : null}
      </div>
      <div className={styles.rowMeta}>
        <StageBadge stage={project.stage} />
        <Updated iso={project.updatedAt} />
      </div>
      <span className={styles.chevron}>
        <Icon name="chevron" />
      </span>
    </li>
  )
}
