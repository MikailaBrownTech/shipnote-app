import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { githubIsEnabled } from '@/server/github-app'
import { listRepoChoices } from '@/server/github-projects'
import { rateLimit } from '@/server/rate-limit'
import { connectGithubAction } from '../../../github/actions'
import styles from '../../../dashboard.module.css'
import { PageIntro } from '../../../page-intro'
import { linkRepoAction } from '../../github-actions'
import { loadOwnProject } from '../../load-project'
import projectStyles from '../../projects.module.css'
import { PageSkeleton } from '../../../skeleton'

export const metadata: Metadata = { title: 'Choose repository' }

export default function ChooseRepoPage({
  params,
}: PageProps<'/dashboard/projects/[id]/repo'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the id, so it sits behind Suspense. */}
      <Suspense fallback={<PageSkeleton back rows={5} />}>
        <ChooseRepo params={params} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function ChooseRepo({
  params,
}: {
  params: PageProps<'/dashboard/projects/[id]/repo'>['params']
}) {
  const user = await requireUser()
  if (!githubIsEnabled()) notFound()
  const project = await loadOwnProject(user.id, params)
  const back = project ? `/dashboard/projects/${project.id}` : '/dashboard'

  const intro = (
    <PageIntro
      title="Choose repository"
      subtitle="Pick the repository whose [post] commits you want to see."
      backHref={back}
      backLabel="Back to project"
    />
  )

  if (!project) {
    return (
      <>
        {intro}
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load this project. Try again in a moment.
        </p>
      </>
    )
  }

  if (!(await rateLimit('githubRepos', user.id))) {
    return (
      <>
        {intro}
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          Too many attempts. Try again in a few minutes.
        </p>
      </>
    )
  }

  // The list comes from GitHub, for the user's own installations. It is not
  // built from anything in the URL.
  const choices = await listRepoChoices(user.id)

  return (
    <>
      {intro}
      <div className={`card ${projectStyles.formWrap}`}>
        {choices.status === 'error' ? (
          <p role="alert" className={`on-pink ${projectStyles.notice}`}>
            {choices.kind === 'rate_limited'
              ? 'GitHub is limiting requests right now. Try again in a few minutes.'
              : choices.kind === 'unavailable'
                ? 'GitHub is not responding. Try again in a moment.'
                : 'We could not load your repositories. Try again.'}
          </p>
        ) : choices.status === 'none' ? (
          <>
            <p className={projectStyles.help}>
              GitHub is not connected. Connect it to choose a repository.
            </p>
            <form action={connectGithubAction}>
              <input type="hidden" name="project" value={project.id} />
              <button type="submit" className="button">
                Connect GitHub
              </button>
            </form>
          </>
        ) : (
          <form action={linkRepoAction.bind(null, project.id)}>
            {choices.groups.map((group) => (
              <fieldset
                key={group.installationId}
                className={projectStyles.repoGroup}
              >
                <legend>{group.accountLogin}</legend>
                {group.repos.length === 0 ? (
                  <p className={projectStyles.help}>
                    This connection cannot see any repositories. Change the
                    app&apos;s repository access on GitHub, then come back.
                  </p>
                ) : (
                  <ul className={projectStyles.repoList}>
                    {group.repos.map((repo) => (
                      <li key={repo}>
                        <label className={projectStyles.repoItem}>
                          <input
                            type="radio"
                            name="choice"
                            value={`${String(group.installationId)}|${repo}`}
                            defaultChecked={project.repoFullName === repo}
                            required
                          />
                          {repo}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            ))}
            <div className={projectStyles.actions}>
              <button type="submit" className="button">
                Link repository
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
