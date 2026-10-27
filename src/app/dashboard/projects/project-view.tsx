import Link from 'next/link'
import { repoUrl } from '@/lib/github-repo'
import { STAGE_LABELS, type Stage } from '@/lib/project-schema'
import type { ProjectTab } from '@/lib/project-tabs'
import type { Project } from '@/server/projects'
import { Icon, type IconName } from '../icons'
import { DeleteProject } from './delete-project'
import styles from './project-page.module.css'
import { DateText, StageBadge, Updated } from './stage-badge'

// The pieces of the project page. All of them are plain presentation of data
// the page already loaded. Everything the user wrote is rendered as text.
// Anything about GitHub is only shown when `githubOn` is true.

const stageBlurb: Record<Stage, string> = {
  idea: 'Planning and early thinking',
  in_progress: 'Active development',
  shipped: 'Released to the world',
}

export function ProjectHeader({ project }: { project: Project }) {
  return (
    <header className={styles.header}>
      <span className={styles.headerIcon} aria-hidden="true">
        <Icon name="code" size={30} />
      </span>
      <div className={styles.headerText}>
        {/* The person's own text: plain, never styled as a phrase. */}
        <h1>{project.name}</h1>
        <div className={styles.headerMeta}>
          <StageBadge stage={project.stage} />
          <Updated iso={project.updatedAt} />
        </div>
      </div>
      <Link href={`/dashboard/projects/${project.id}/edit`} className="button">
        <Icon name="edit" size={18} />
        Edit project
      </Link>
    </header>
  )
}

// Links to the sections below. Plain anchors, so it works without scripts.
export function ProjectTabs({
  projectId,
  active,
  githubOn,
}: {
  projectId: string
  active: ProjectTab
  githubOn: boolean
}) {
  const tabs: { tab: ProjectTab; label: string; icon: IconName }[] = [
    { tab: 'overview', label: 'Overview', icon: 'home' },
    ...(githubOn
      ? [{ tab: 'github' as const, label: 'GitHub', icon: 'github' as const }]
      : []),
    { tab: 'notes', label: 'Notes', icon: 'note' },
  ]
  return (
    <nav className={styles.tabs} aria-label="Sections of this project">
      {tabs.map(({ tab, label, icon }) => (
        <Link
          key={tab}
          href={`/dashboard/projects/${projectId}?tab=${tab}`}
          className={tab === active ? styles.tabActive : undefined}
          aria-current={tab === active ? 'page' : undefined}
        >
          <Icon name={icon} size={18} />
          {label}
        </Link>
      ))}
    </nav>
  )
}

// Two small cards: the GitHub connection and the stage.
export function StatusCards({
  project,
  githubOn,
}: {
  project: Project
  githubOn: boolean
}) {
  const connected = project.repoFullName && project.installationId !== null
  const needsReconnect = project.repoFullName && project.installationId === null

  return (
    <div className={`${styles.statusRow} ${githubOn ? '' : styles.statusOne}`}>
      {githubOn ? (
        <section className={`card ${styles.statusCard}`}>
          <span className={styles.statusIcon} aria-hidden="true">
            <Icon name="github" size={26} />
          </span>
          <div className={styles.statusBody}>
            <h2>GitHub connection</h2>
            <p
              className={`${styles.pill} ${
                connected
                  ? styles.pillGood
                  : needsReconnect
                    ? styles.pillWarn
                    : styles.pillIdle
              }`}
            >
              {connected
                ? 'Connected'
                : needsReconnect
                  ? 'Needs reconnect'
                  : 'No repository linked'}
            </p>
            {project.repoFullName ? (
              <p className={styles.statusText}>{project.repoFullName}</p>
            ) : (
              <p className={styles.statusText}>
                Link a repository to see your [post] commits.
              </p>
            )}
          </div>
          <Link
            href={`/dashboard/projects/${project.id}?tab=github`}
            className="button button-soft"
          >
            Manage
          </Link>
        </section>
      ) : null}

      <section className={`card ${styles.statusCard}`}>
        <span className={styles.statusIcon} aria-hidden="true">
          <Icon name="chart" size={26} />
        </span>
        <div className={styles.statusBody}>
          <h2>Project stage</h2>
          <p>
            <StageBadge stage={project.stage} />
          </p>
          <p className={styles.statusText}>{stageBlurb[project.stage]}</p>
        </div>
      </section>
    </div>
  )
}

// What the product will do, said plainly: drafts are not built yet, and the
// person always edits and posts themselves.
export function ProgressPanel() {
  const steps: { n: number; title: string; text: string }[] = [
    {
      n: 1,
      title: 'Choose your progress',
      text: 'Keep notes here, and tag commits [post] when you ship something.',
    },
    {
      n: 2,
      title: 'Drafts (coming soon)',
      text: 'Shipnote will turn your technical work into a post draft.',
    },
    {
      n: 3,
      title: 'Edit and copy',
      text: 'You edit the draft and post it yourself. Shipnote never posts.',
    },
  ]
  return (
    <section className={`card ${styles.progress}`}>
      <div className={styles.progressHead}>
        <span className={styles.progressIcon} aria-hidden="true">
          <Icon name="bolt" size={26} />
        </span>
        <div>
          <h2>Turn your progress into LinkedIn content</h2>
          <p>Drafts are not available yet. Here is how it will work.</p>
        </div>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.n}>
            <span className={styles.stepNumber}>{step.n}</span>
            <div>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </div>
            {index < steps.length - 1 ? (
              <span className={styles.stepArrow} aria-hidden="true">
                <Icon name="arrowRight" size={20} />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function NotesCard({ project }: { project: Project }) {
  return (
    <section
      id="notes"
      className={`card ${styles.notesCard}`}
      aria-labelledby="notes-title"
    >
      <h2 id="notes-title">
        <Icon name="note" size={20} />
        Notes
      </h2>
      {project.notes ? (
        /* Plain text: line breaks kept, never read as markup. */
        <div className={styles.notes}>{project.notes}</div>
      ) : (
        <p className={styles.statusText}>
          No notes yet. Add some when you edit.
        </p>
      )}
    </section>
  )
}

// The right-hand column.
export function DetailsCard({ project }: { project: Project }) {
  return (
    <section
      className={`card ${styles.sideCard}`}
      aria-labelledby="details-title"
    >
      <div className={styles.sideHead}>
        <h2 id="details-title">
          <Icon name="note" size={20} />
          Project details
        </h2>
        <Link
          href={`/dashboard/projects/${project.id}/edit`}
          className={styles.smallButton}
        >
          <Icon name="edit" size={14} />
          Edit
        </Link>
      </div>
      <dl className={styles.details}>
        <div>
          <dt>Name</dt>
          <dd>{project.name}</dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{project.summary ?? 'No summary'}</dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd>{STAGE_LABELS[project.stage]}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <DateText iso={project.createdAt} />
          </dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <DateText iso={project.updatedAt} />
          </dd>
        </div>
      </dl>
    </section>
  )
}

function ActionRow({
  icon,
  tone,
  title,
  text,
  href,
  external,
}: {
  icon: IconName
  tone: string
  title: string
  text: string
  href: string
  external?: boolean
}) {
  const body = (
    <>
      <span className={`${styles.actionIcon} ${tone}`} aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className={styles.actionText}>
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <Icon name={external ? 'external' : 'chevron'} size={18} />
    </>
  )
  return external ? (
    <a
      href={href}
      className={styles.action}
      target="_blank"
      rel="noreferrer noopener"
    >
      {body}
    </a>
  ) : (
    <Link href={href} className={styles.action}>
      {body}
    </Link>
  )
}

export function QuickActions({
  project,
  githubOn,
}: {
  project: Project
  githubOn: boolean
}) {
  const path = `/dashboard/projects/${project.id}`
  return (
    <section
      className={`card ${styles.sideCard}`}
      aria-labelledby="actions-title"
    >
      <h2 id="actions-title" className={styles.sideTitle}>
        <Icon name="bolt" size={20} />
        Quick actions
      </h2>
      <div className={styles.actions}>
        <ActionRow
          icon="edit"
          tone={styles.toneViolet}
          title="Edit project"
          text="Change the details and notes"
          href={`${path}/edit`}
        />
        {githubOn && project.repoFullName ? (
          <ActionRow
            icon="github"
            tone={styles.toneInk}
            title="View on GitHub"
            text="Open the repository"
            // Built from the validated repository name, not from GitHub.
            href={repoUrl(project.repoFullName)}
            external
          />
        ) : null}
        {githubOn ? (
          <ActionRow
            icon="folder"
            tone={styles.toneTeal}
            title={
              project.repoFullName ? 'Change repository' : 'Choose a repository'
            }
            text="Link this project to a repository"
            href={`${path}/repo`}
          />
        ) : null}
        <div className={styles.deleteRow}>
          <span
            className={`${styles.actionIcon} ${styles.toneRose}`}
            aria-hidden="true"
          >
            <Icon name="trash" size={22} />
          </span>
          <DeleteProject id={project.id} />
        </div>
      </div>
    </section>
  )
}

export function TipsCard() {
  const tips = [
    'Recent progress beats old history',
    'Say what you built and why it matters',
    'Keep out anything you would not post publicly',
    'Never paste secrets or customer data',
  ]
  return (
    <section className={`card ${styles.tips}`} aria-labelledby="tips-title">
      <h2 id="tips-title" className={styles.sideTitle}>
        <Icon name="bulb" size={20} />
        Make the notes count
      </h2>
      <ul>
        {tips.map((tip) => (
          <li key={tip}>
            <span className={styles.tick} aria-hidden="true">
              <Icon name="check" size={13} />
            </span>
            {tip}
          </li>
        ))}
      </ul>
    </section>
  )
}
