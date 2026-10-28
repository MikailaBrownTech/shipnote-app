import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { parseBufferFlash } from '@/lib/buffer-flash'
import { parseGithubFlash } from '@/lib/github-flash'
import { PROJECT_LIMITS, type Stage } from '@/lib/project-schema'
import { githubIsEnabled } from '@/server/github-app'
import { listProjects } from '@/server/projects'
import { schedulingIsEnabled } from '@/server/scheduling'
import { AccountMenu } from './account-menu'
import { BufferDashboardPanel } from './buffer/dashboard-panel'
import { GithubDashboardPanel } from './github/dashboard-panel'
import styles from './dashboard.module.css'
import { Icon, type IconName } from './icons'
import { PageIntro } from './page-intro'
import { StageBadge, Updated } from './projects/stage-badge'
import projectStyles from './projects/projects.module.css'
import shell from './shell.module.css'
import { PageSkeleton } from './skeleton'

export const metadata: Metadata = { title: 'Dashboard' }

const stageIcons: Record<Stage, IconName> = {
  idea: 'bulb',
  in_progress: 'bolt',
  shipped: 'rocket',
}

const stageTones: Record<Stage, string> = {
  idea: projectStyles.idea,
  in_progress: projectStyles.inProgress,
  shipped: projectStyles.shipped,
}

export default function DashboardPage({
  searchParams,
}: PageProps<'/dashboard'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session, so it sits behind Suspense. */}
      <Suspense fallback={<PageSkeleton tiles={4} rows={5} side />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Dashboard({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard'>['searchParams']
}) {
  const user = await requireUser()
  // Only a known code is shown, as fixed text; the raw value is never echoed.
  const flash = githubIsEnabled()
    ? parseGithubFlash((await searchParams).github)
    : null
  const bufferFlash = schedulingIsEnabled()
    ? parseBufferFlash((await searchParams).buffer)
    : null
  const result = await listProjects(user.id)
  const projects = result.ok ? result.value : []
  const inStage = (stage: Stage) =>
    projects.filter((project) => project.stage === stage).length
  const full = projects.length >= PROJECT_LIMITS.perUser

  const tiles = [
    {
      label: 'Projects',
      value: projects.length,
      note: `of ${String(PROJECT_LIMITS.perUser)} allowed`,
      icon: 'folder',
      tone: shell.tileViolet,
    },
    {
      label: 'Ideas',
      value: inStage('idea'),
      note: 'not started',
      icon: 'bulb',
      tone: shell.tilePink,
    },
    {
      label: 'In progress',
      value: inStage('in_progress'),
      note: 'being built',
      icon: 'bolt',
      tone: shell.tileAzure,
    },
    {
      label: 'Shipped',
      value: inStage('shipped'),
      note: 'out the door',
      icon: 'rocket',
      tone: shell.tileTeal,
    },
  ] as const

  return (
    <>
      <PageIntro
        title="Welcome back"
        subtitle={
          user.email
            ? `Signed in as ${user.email}`
            : 'Your projects, in one place.'
        }
      >
        <AccountMenu email={user.email} />
      </PageIntro>

      {result.ok ? (
        <ul className={shell.tiles} aria-label="Your projects at a glance">
          {tiles.map((tile) => (
            <li key={tile.label} className={`${shell.tile} ${tile.tone}`}>
              <span className={shell.tileIcon}>
                <Icon name={tile.icon} size={22} />
              </span>
              <div>
                <p>{tile.label}</p>
                <strong>{tile.value}</strong>
                <p>{tile.note}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className={shell.grid}>
        <section
          className={`card ${shell.panel}`}
          aria-labelledby="projects-title"
        >
          <div className={shell.panelHead}>
            <h2 id="projects-title">Projects</h2>
            {result.ok && projects.length > 0 ? (
              <p>
                {projects.length} of {PROJECT_LIMITS.perUser}
              </p>
            ) : null}
            {result.ok && projects.length > 0 && !full ? (
              <Link href="/dashboard/projects/new" className="button">
                New project
              </Link>
            ) : null}
          </div>

          {!result.ok ? (
            <p role="alert" className={`on-pink ${projectStyles.notice}`}>
              We could not load your projects. Try again in a moment.
            </p>
          ) : projects.length === 0 ? (
            <div className={`on-violet ${projectStyles.empty}`}>
              <h3>No projects yet</h3>
              <p>
                A project holds the notes Shipnote will turn into LinkedIn post
                drafts. Add one to get started.
              </p>
              <Link href="/dashboard/projects/new" className="button">
                New project
              </Link>
            </div>
          ) : (
            <>
              {full ? (
                <p className={`on-amber ${projectStyles.notice}`}>
                  You have reached the {PROJECT_LIMITS.perUser} project limit.
                  Delete one to add another.
                </p>
              ) : null}
              <ul className={projectStyles.rows}>
                {projects.map((project) => (
                  <li key={project.id} className={projectStyles.row}>
                    <span
                      className={`${projectStyles.rowIcon} ${projectStyles.iconTone} ${stageTones[project.stage]}`}
                    >
                      <Icon name={stageIcons[project.stage]} />
                    </span>
                    <div className={projectStyles.rowBody}>
                      <h3>
                        <Link href={`/dashboard/projects/${project.id}`}>
                          {project.name}
                        </Link>
                      </h3>
                      {project.summary ? (
                        <p className={projectStyles.rowSummary}>
                          {project.summary}
                        </p>
                      ) : null}
                    </div>
                    <div className={projectStyles.rowMeta}>
                      <StageBadge stage={project.stage} />
                      <Updated iso={project.updatedAt} />
                    </div>
                    <span className={projectStyles.chevron}>
                      <Icon name="chevron" />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className={shell.rail}>
          <GithubDashboardPanel userId={user.id} flash={flash} />
          <BufferDashboardPanel flash={bufferFlash} />
          <section
            className={`card ${shell.panel}`}
            aria-labelledby="how-title"
          >
            <h2 id="how-title" className={shell.panelTitle}>
              How it works
            </h2>
            <ol className={shell.steps}>
              <li>
                <span className={`${shell.stepIcon} ${shell.tileViolet}`}>
                  <Icon name="note" />
                </span>
                <div>
                  <strong>Add your notes</strong>
                  <span>
                    Create a project and paste your README, spec or progress
                    notes.
                  </span>
                </div>
              </li>
              <li>
                <span className={`${shell.stepIcon} ${shell.tilePink}`}>
                  <Icon name="bolt" />
                </span>
                <div>
                  <strong>Drafts (coming soon)</strong>
                  <span>
                    Shipnote will turn your notes into LinkedIn post drafts.
                  </span>
                </div>
              </li>
              <li>
                <span className={`${shell.stepIcon} ${shell.tileTeal}`}>
                  <Icon name="copy" />
                </span>
                <div>
                  <strong>Edit and copy</strong>
                  <span>
                    You change the draft and post it yourself. Shipnote never
                    posts for you.
                  </span>
                </div>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </>
  )
}
