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
import { loadStart, StartFromRepo } from './start-from-repo'

export const metadata: Metadata = { title: 'New project' }

export default function NewProjectPage({
  searchParams,
}: PageProps<'/dashboard/projects/new'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the URL, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading</p>}>
        <NewProject searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function NewProject({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard/projects/new'>['searchParams']
}) {
  const user = await requireUser()
  const existing = await listProjects(user.id)
  // The database enforces the cap. This only saves a pointless form.
  const full = existing.ok && existing.value.length >= PROJECT_LIMITS.perUser

  // Reading from GitHub to fill the form. It never saves anything.
  const start = full
    ? ({ kind: 'hidden' } as const)
    : await loadStart(user.id, await searchParams)
  const prefilled = start.kind === 'prefilled' ? start : null

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
          <div className={shell.stack}>
            <StartFromRepo state={start} />
            <div className={`card ${projectStyles.formWrap}`}>
              <ProjectForm
                // A new key starts the form over with the chosen repository.
                key={prefilled?.link.repoFullName ?? 'blank'}
                action={createProjectAction}
                initial={
                  prefilled
                    ? {
                        name: prefilled.prefill.name,
                        summary: prefilled.prefill.summary,
                        stage: prefilled.prefill.stage,
                        notes: prefilled.prefill.notes,
                      }
                    : { name: '', summary: '', stage: 'idea', notes: '' }
                }
                github={prefilled?.link}
                submitLabel="Create project"
                cancelHref="/dashboard"
              />
            </div>
          </div>
        )}
        <FormRail />
      </div>
    </>
  )
}
