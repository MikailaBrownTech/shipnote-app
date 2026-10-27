import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { PROJECT_LIMITS } from '@/lib/project-schema'
import { listProjects } from '@/server/projects'
import styles from '../../dashboard.module.css'
import { PageIntro } from '../../page-intro'
import { FormRail } from '../../rail'
import shell from '../../shell.module.css'
import { createProjectAction } from '../actions'
import { ProjectForm } from '../project-form'
import projectStyles from '../projects.module.css'

export const metadata: Metadata = { title: 'New project' }

export default function NewProjectPage() {
  return (
    <main className={styles.main}>
      {/* Reads the session, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading</p>}>
        <NewProject />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function NewProject() {
  const user = await requireUser()
  const existing = await listProjects(user.id)
  // The database enforces the cap. This only saves a pointless form.
  const full = existing.ok && existing.value.length >= PROJECT_LIMITS.perUser

  return (
    <>
      <PageIntro
        title="New project"
        subtitle="Add a project to start turning your development work into LinkedIn content."
        backHref="/dashboard"
      />

      <div className={shell.twoCol}>
        {full ? (
          <p className={`on-amber ${projectStyles.notice}`}>
            You have reached the {PROJECT_LIMITS.perUser} project limit. Delete
            a project to add another.
          </p>
        ) : (
          <div className={`card ${projectStyles.formWrap}`}>
            <ProjectForm
              action={createProjectAction}
              initial={{ name: '', summary: '', stage: 'idea', notes: '' }}
              submitLabel="Create project"
              cancelHref="/dashboard"
            />
          </div>
        )}
        <FormRail />
      </div>
    </>
  )
}
