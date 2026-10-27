import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import styles from '../../dashboard.module.css'
import { Icon } from '../../icons'
import { PageIntro } from '../../page-intro'
import { DetailRail } from '../../rail'
import shell from '../../shell.module.css'
import { DeleteProject } from '../delete-project'
import { loadOwnProject } from '../load-project'
import projectStyles from '../projects.module.css'
import { StageBadge, Updated } from '../stage-badge'

// Static on purpose: the project's name is private data and stays out of the
// page title.
export const metadata: Metadata = { title: 'Project' }

export default function ProjectPage({
  params,
}: PageProps<'/dashboard/projects/[id]'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the id, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your project</p>}>
        <Project params={params} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Project({
  params,
}: {
  params: PageProps<'/dashboard/projects/[id]'>['params']
}) {
  const user = await requireUser()
  const project = await loadOwnProject(user.id, params)

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
      {/* The title is the person's own text, so it is not styled as a phrase. */}
      <PageIntro
        title={project.name}
        accent={false}
        subtitle={
          <span className={projectStyles.meta}>
            <StageBadge stage={project.stage} />
            <Updated iso={project.updatedAt} />
          </span>
        }
        backHref="/dashboard"
      />

      <div className={shell.twoCol}>
        {/* Everything below is rendered as plain text. */}
        <article className={`card ${projectStyles.detail}`}>
          {project.summary ? (
            <p className={projectStyles.summary}>{project.summary}</p>
          ) : null}

          <h2 className={projectStyles.notesTitle}>Notes</h2>
          {project.notes ? (
            <div className={projectStyles.notes}>{project.notes}</div>
          ) : (
            <p className={projectStyles.notesEmpty}>No notes yet.</p>
          )}

          <div className={projectStyles.detailActions}>
            <Link
              href={`/dashboard/projects/${project.id}/edit`}
              className="button"
            >
              <Icon name="edit" size={18} />
              Edit project
            </Link>
            <DeleteProject id={project.id} />
          </div>
        </article>
        <DetailRail />
      </div>
    </>
  )
}
