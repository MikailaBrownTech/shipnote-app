import Link from 'next/link'
import { GITHUB_FLASH_MESSAGES, type GithubFlash } from '@/lib/github-flash'
import { githubIsEnabled } from '@/server/github-app'
import { listInstallations } from '@/server/github-projects'
import type { Project } from '@/server/projects'
import { connectGithubAction } from '../github/actions'
import { Icon } from '../icons'
import { DisconnectGithub } from '../github/disconnect-github'
import { CheckCommits } from './github-controls'
import { disconnectGithubAction, unlinkRepoAction } from './github-actions'
import styles from './projects.module.css'

// The GitHub card on a project page. It renders nothing while the feature is
// off, so no GitHub button is shown. Everything here is plain text.

export function FlashNotice({ flash }: { flash: GithubFlash | null }) {
  if (!flash) return null
  const { tone, text } = GITHUB_FLASH_MESSAGES[flash]
  return (
    <p
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`${tone === 'bad' ? 'on-pink' : 'on-azure'} ${styles.notice}`}
    >
      {text}
    </p>
  )
}

function ConnectButton({
  project,
  label,
}: {
  project: string
  label: 'Connect GitHub' | 'Reconnect GitHub'
}) {
  return (
    <form action={connectGithubAction}>
      <input type="hidden" name="project" value={project} />
      <button type="submit" className="button">
        <Icon name="arrowRight" size={18} />
        {label}
      </button>
    </form>
  )
}

export async function GithubPanel({
  userId,
  project,
  flash,
}: {
  userId: string
  project: Project
  flash: GithubFlash | null
}) {
  if (!githubIsEnabled()) return null

  const path = `/dashboard/projects/${project.id}`
  const installations = await listInstallations(userId)
  const repo = project.repoFullName
  const connected = project.installationId !== null

  return (
    <section className={`card ${styles.github}`} aria-labelledby="github-title">
      <h2 id="github-title" className={styles.githubTitle}>
        <Icon name="gear" size={20} />
        GitHub
      </h2>
      <FlashNotice flash={flash} />

      {installations === null ? (
        <p role="alert" className={`on-pink ${styles.notice}`}>
          We could not load your GitHub connection. Try again in a moment.
        </p>
      ) : installations.length === 0 ? (
        <>
          <p className={styles.help}>
            {repo
              ? `The link to ${repo} needs GitHub to be connected again.`
              : 'Connect GitHub to find the commits you tagged [post].'}{' '}
            Shipnote asks for read-only access to repository contents and
            metadata, and stores no code or commits. You can disconnect at any
            time.
          </p>
          <div className={styles.githubActions}>
            <ConnectButton
              project={project.id}
              label={repo ? 'Reconnect GitHub' : 'Connect GitHub'}
            />
            {repo ? (
              <form action={unlinkRepoAction.bind(null, project.id)}>
                <button type="submit" className="button button-soft">
                  Unlink repository
                </button>
              </form>
            ) : null}
          </div>
        </>
      ) : repo && !connected ? (
        <>
          <p className={styles.help}>
            This project is linked to <strong>{repo}</strong>, but GitHub access
            for it was removed.
          </p>
          <div className={styles.githubActions}>
            <ConnectButton project={project.id} label="Reconnect GitHub" />
            <form action={unlinkRepoAction.bind(null, project.id)}>
              <button type="submit" className="button button-soft">
                Unlink repository
              </button>
            </form>
          </div>
        </>
      ) : repo ? (
        <>
          <p className={styles.help}>
            Linked repository: <strong>{repo}</strong>
          </p>
          <CheckCommits projectId={project.id} />
          <div className={styles.githubActions}>
            <Link href={`${path}/repo`} className="button button-soft">
              Change repository
            </Link>
            <form action={unlinkRepoAction.bind(null, project.id)}>
              <button type="submit" className="button button-soft">
                Unlink repository
              </button>
            </form>
            {project.installationId !== null ? (
              <DisconnectGithub
                action={disconnectGithubAction.bind(null, project.id)}
                installationId={project.installationId}
              />
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className={styles.help}>
            GitHub is connected. Link one of your repositories to this project
            to see your [post] commits.
          </p>
          <div className={styles.githubActions}>
            <Link href={`${path}/repo`} className="button">
              Choose a repository
            </Link>
            {installations[0] ? (
              <DisconnectGithub
                action={disconnectGithubAction.bind(null, project.id)}
                installationId={installations[0].installationId}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
