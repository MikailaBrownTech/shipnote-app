import Link from 'next/link'
import type { GithubFlash } from '@/lib/github-flash'
import { githubIsEnabled } from '@/server/github-app'
import { listInstallations } from '@/server/github-projects'
import { Icon } from '../icons'
import { FlashNotice } from '../projects/github-panel'
import projectStyles from '../projects/projects.module.css'
import shell from '../shell.module.css'
import {
  connectGithubAction,
  disconnectGithubFromDashboardAction,
} from './actions'
import { DisconnectGithub } from './disconnect-github'

// The GitHub panel on the dashboard home. It renders nothing while the feature
// is off, so no GitHub text or button appears. Account logins are shown as
// plain text.
export async function GithubDashboardPanel({
  userId,
  flash,
}: {
  userId: string
  flash: GithubFlash | null
}) {
  if (!githubIsEnabled()) return null

  const installations = await listInstallations(userId)

  return (
    <section
      className={`card ${shell.panel}`}
      aria-labelledby="github-dashboard-title"
    >
      <h2 id="github-dashboard-title" className={shell.panelTitle}>
        GitHub
      </h2>
      <FlashNotice flash={flash} />

      {installations === null ? (
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load your GitHub connection. Try again in a moment.
        </p>
      ) : installations.length === 0 ? (
        <>
          <p className={shell.panelText}>
            Connect GitHub so Shipnote can find the commits you tag{' '}
            <code>[post]</code>. It gets read-only access to the repos you
            choose, and Shipnote never posts for you.
          </p>
          <form action={connectGithubAction}>
            <button type="submit" className="button">
              <Icon name="arrowRight" size={18} />
              Connect GitHub
            </button>
          </form>
        </>
      ) : (
        <>
          <ul className={shell.connList}>
            {installations.map((installation) => (
              <li key={installation.installationId} className={shell.connRow}>
                <p>
                  Connected as <strong>{installation.accountLogin}</strong>
                </p>
                <DisconnectGithub
                  action={disconnectGithubFromDashboardAction}
                  installationId={installation.installationId}
                />
              </li>
            ))}
          </ul>
          <Link href="/dashboard#projects-title" className="button button-soft">
            View your projects
          </Link>
        </>
      )}
    </section>
  )
}
