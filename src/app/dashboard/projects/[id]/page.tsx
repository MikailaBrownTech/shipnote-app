import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { parseGithubFlash } from '@/lib/github-flash'
import { chooseTab } from '@/lib/project-tabs'
import { aiIsEnabled } from '@/server/draft-generation'
import { githubIsEnabled } from '@/server/github-app'
import styles from '../../dashboard.module.css'
import { Icon } from '../../icons'
import { PageIntro } from '../../page-intro'
import shell from '../../shell.module.css'
import { DraftPanel } from '../draft-panel'
import { FlashNotice, GithubPanel } from '../github-panel'
import { loadOwnProject } from '../load-project'
import projectStyles from '../projects.module.css'
import pageStyles from '../project-page.module.css'
import {
  DetailsCard,
  NotesCard,
  ProgressPanel,
  ProjectHeader,
  ProjectTabs,
  QuickActions,
  StatusCards,
  TipsCard,
} from '../project-view'
import { PageSkeleton } from '../../skeleton'

// Static on purpose: the project's name is private data and stays out of the
// page title.
export const metadata: Metadata = { title: 'Project' }

// How long the Server Actions on this page may run, in seconds (Next.js takes it
// from the page). Generate draft reads commits from GitHub, then waits for one
// Claude call of up to 40 seconds, so the platform default is too short. It is
// the same limit as the automatic draft worker.
export const maxDuration = 60

export default function ProjectPage({
  params,
  searchParams,
}: PageProps<'/dashboard/projects/[id]'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the id, so it sits behind Suspense. */}
      <Suspense fallback={<PageSkeleton back tabs rows={4} side />}>
        <Project params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Project({
  params,
  searchParams,
}: {
  params: PageProps<'/dashboard/projects/[id]'>['params']
  searchParams: PageProps<'/dashboard/projects/[id]'>['searchParams']
}) {
  const user = await requireUser()
  const project = await loadOwnProject(user.id, params)
  const githubOn = githubIsEnabled()
  const query = await searchParams
  // Only a known code is shown, as fixed text; the raw value is never echoed.
  const flash = githubOn ? parseGithubFlash(query.github) : null
  // Only a tab from the fixed list is used; anything else is ignored.
  const aiOn = aiIsEnabled()
  const tab = chooseTab({
    value: query.tab,
    githubOn,
    hasGithubMessage: flash !== null,
    aiOn,
  })

  if (!project) {
    return (
      <>
        <PageIntro title="Project" backHref="/dashboard" />
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load this project. Try again in a moment.
        </p>
      </>
    )
  }

  return (
    <>
      <Link
        href="/dashboard/projects"
        className={`${shell.back} ${pageStyles.back}`}
      >
        <Icon name="arrowLeft" size={16} />
        Back to projects
      </Link>

      <ProjectHeader project={project} />
      <ProjectTabs
        projectId={project.id}
        active={tab}
        githubOn={githubOn}
        aiOn={aiOn}
      />
      <FlashNotice flash={flash} />

      <div className={shell.twoCol}>
        <div className={shell.stack}>
          {tab === 'overview' ? (
            <>
              <StatusCards project={project} githubOn={githubOn} />
              <ProgressPanel aiOn={aiOn} />
            </>
          ) : null}
          {tab === 'github' ? (
            <GithubPanel userId={user.id} project={project} flash={null} />
          ) : null}
          {tab === 'drafts' ? (
            <DraftPanel userId={user.id} project={project} />
          ) : null}
          {tab === 'notes' ? <NotesCard project={project} /> : null}
        </div>
        <aside
          className={pageStyles.rail}
          aria-label="Project summary and actions"
        >
          <DetailsCard project={project} />
          <QuickActions project={project} githubOn={githubOn} />
          <TipsCard />
        </aside>
      </div>
    </>
  )
}
