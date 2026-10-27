import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { PROJECT_LIMITS } from '@/lib/project-schema'
import { listProjects } from '@/server/projects'
import { AccountMenu } from './account-menu'
import styles from './dashboard.module.css'
import { StageBadge, Updated } from './projects/stage-badge'
import projectStyles from './projects/projects.module.css'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <main className={`page ${styles.main}`}>
      {/* Reads the session, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your dashboard</p>}>
        <Dashboard />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Dashboard() {
  const user = await requireUser()
  const result = await listProjects(user.id)

  return (
    <>
      <header className={styles.header}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
        <AccountMenu email={user.email} />
      </header>

      <div className={styles.top}>
        <h1 className={styles.title}>Dashboard</h1>
        {user.email ? (
          <p className={`card ${styles.who}`}>Signed in as {user.email}</p>
        ) : null}
      </div>

      <section aria-labelledby="projects-title">
        <div className={projectStyles.sectionHead}>
          <h2 id="projects-title">Projects</h2>
          {result.ok && result.value.length > 0 ? (
            <>
              <p className={projectStyles.count}>
                {result.value.length} of {PROJECT_LIMITS.perUser}
              </p>
              {result.value.length < PROJECT_LIMITS.perUser ? (
                <Link href="/dashboard/projects/new" className="button">
                  New project
                </Link>
              ) : null}
            </>
          ) : null}
        </div>

        {!result.ok ? (
          <p role="alert" className={`on-pink ${projectStyles.notice}`}>
            We could not load your projects. Try again in a moment.
          </p>
        ) : result.value.length === 0 ? (
          <div className={`card ${projectStyles.empty}`}>
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
            {result.value.length >= PROJECT_LIMITS.perUser ? (
              <p className={`on-amber ${projectStyles.notice}`}>
                You have reached the {PROJECT_LIMITS.perUser} project limit.
                Delete one to add another.
              </p>
            ) : null}
            <ul className={projectStyles.list}>
              {result.value.map((project) => (
                <li key={project.id} className={`card ${projectStyles.item}`}>
                  <h3>
                    <Link href={`/dashboard/projects/${project.id}`}>
                      {project.name}
                    </Link>
                  </h3>
                  <div className={projectStyles.meta}>
                    <StageBadge stage={project.stage} />
                    <Updated iso={project.updatedAt} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  )
}
