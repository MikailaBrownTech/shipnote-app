import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import styles from '../../../dashboard.module.css'
import { updateProjectAction } from '../../actions'
import { loadOwnProject } from '../../load-project'
import { PageHeader } from '../../page-header'
import { ProjectForm } from '../../project-form'
import projectStyles from '../../projects.module.css'

export const metadata: Metadata = { title: 'Edit project' }

export default function EditProjectPage({
  params,
}: PageProps<'/dashboard/projects/[id]/edit'>) {
  return (
    <main className={`page ${styles.main}`}>
      {/* Reads the session and the id, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your project</p>}>
        <EditProject params={params} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function EditProject({
  params,
}: {
  params: PageProps<'/dashboard/projects/[id]/edit'>['params']
}) {
  const user = await requireUser()
  const project = await loadOwnProject(user.id, params)

  if (!project) {
    return (
      <>
        <PageHeader />
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load this project. Try again in a moment.
        </p>
      </>
    )
  }

  return (
    <>
      <PageHeader
        backHref={`/dashboard/projects/${project.id}`}
        backLabel="Back to project"
      />
      <h1 className={styles.title}>Edit project</h1>
      <div className={`card ${projectStyles.formWrap}`}>
        <ProjectForm
          action={updateProjectAction.bind(null, project.id)}
          initial={{
            name: project.name,
            summary: project.summary ?? '',
            stage: project.stage,
            notes: project.notes,
          }}
          submitLabel="Save changes"
          cancelHref={`/dashboard/projects/${project.id}`}
        />
      </div>
    </>
  )
}
