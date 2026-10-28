import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import {
  GITHUB_TABS,
  SORTS,
  SORT_LABELS,
  TAB_LABELS,
  chooseGithubTab,
  chooseRepo,
  chooseSort,
  cleanSearch,
  filterRepos,
  githubHref,
  languageColor,
  sortRepos,
  timeAgo,
} from '@/lib/github-view'
import { repoUrl } from '@/lib/github-repo'
import { aiIsEnabled } from '@/server/draft-generation'
import { githubIsEnabled } from '@/server/github-app'
import {
  loadGithubOverview,
  type GithubAccount,
  type OverviewRepo,
} from '@/server/github-overview'
import { checkPostCommits } from '@/server/github-projects'
import { rateLimit } from '@/server/rate-limit'
import styles from '../dashboard.module.css'
import { Icon, type IconName } from '../icons'
import { PageIntro } from '../page-intro'
import projectStyles from '../projects/projects.module.css'
import { DateText } from '../projects/stage-badge'
import shell from '../shell.module.css'
import {
  connectGithubAction,
  disconnectGithubFromDashboardAction,
  syncGithubAction,
} from './actions'
import { DisconnectGithub } from './disconnect-github'
import github from './github.module.css'

export const metadata: Metadata = { title: 'GitHub' }

export default function GithubPage({
  searchParams,
}: PageProps<'/dashboard/github'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the address, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading GitHub</p>}>
        <Github searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

const timeFormat = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

const TONES = [
  github.toneViolet,
  github.toneAzure,
  github.tonePink,
  github.toneTeal,
  github.toneAmber,
] as const

const INTRO = {
  title: 'GitHub',
  subtitle: 'Connect and explore your development activity.',
} as const

function Notice({
  tone,
  children,
}: {
  tone: 'on-pink' | 'on-azure'
  children: React.ReactNode
}) {
  return (
    <p role="alert" className={`${tone} ${projectStyles.notice}`}>
      {children}
    </p>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Github({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard/github'>['searchParams']
}) {
  const user = await requireUser()
  const query = await searchParams
  const tab = chooseGithubTab(query.tab)
  const q = cleanSearch(query.q)
  const sort = chooseSort(query.sort)

  if (!githubIsEnabled()) {
    return (
      <>
        <PageIntro {...INTRO} accent={false} />
        <Notice tone="on-azure">
          GitHub is switched off right now. Your projects and drafts still work.
        </Notice>
      </>
    )
  }

  // Each view reads live from GitHub, so it is rate limited. The brake fails
  // open: it is only an extra.
  if (!(await rateLimit('githubOverview', user.id))) {
    return (
      <>
        <PageIntro {...INTRO} accent={false} />
        <Notice tone="on-pink">
          Too many refreshes. Try again in a few minutes.
        </Notice>
      </>
    )
  }

  const overview = await loadGithubOverview(user.id)

  if (overview.status === 'error') {
    return (
      <>
        <PageIntro {...INTRO} accent={false} />
        <Notice tone="on-pink">
          {overview.kind === 'rate_limited'
            ? 'GitHub is limiting requests right now. Try again in a few minutes.'
            : 'We could not reach GitHub. Try again in a moment.'}
        </Notice>
      </>
    )
  }

  if (overview.status === 'none') {
    return (
      <>
        <PageIntro {...INTRO} accent={false} />
        <section className={`card ${github.connect}`}>
          <span className={github.mark}>
            <Icon name="github" size={32} />
          </span>
          <div>
            <h2>Connect GitHub</h2>
            <p>
              Connect GitHub so Shipnote can find the commits you tag{' '}
              <code>[post]</code>. It gets read-only access to the repositories
              you choose, and Shipnote never posts for you.
            </p>
          </div>
          <form action={connectGithubAction}>
            <button type="submit" className="button">
              <Icon name="arrowRight" size={18} />
              Connect GitHub
            </button>
          </form>
        </section>
      </>
    )
  }

  const { accounts, repos, readAt: nowMs } = overview
  const shown = sortRepos(filterRepos(repos, q), sort)
  // The repository chosen in the address, if it is one of theirs; otherwise the
  // first one shown.
  const selected =
    chooseRepo(query.repo, repos) ?? shown.at(0) ?? repos.at(0) ?? null
  const view = (patch: Parameters<typeof githubHref>[0]) =>
    githubHref({ tab, q, sort, repo: selected?.fullName ?? null, ...patch })

  return (
    <>
      <PageIntro {...INTRO} accent={false}>
        <div className={github.sync}>
          <form action={syncGithubAction}>
            <button type="submit" className="button">
              <Icon name="refresh" size={18} />
              Sync now
            </button>
          </form>
          <p>Read from GitHub at {timeFormat.format(nowMs)} UTC</p>
        </div>
      </PageIntro>

      <div className={shell.twoCol}>
        <div className={shell.stack}>
          {accounts.map((account) => (
            <ConnectionCard key={account.installationId} account={account} />
          ))}

          <nav aria-label="GitHub sections" className={github.tabs}>
            {GITHUB_TABS.map((t) => (
              <Link
                key={t}
                href={view({ tab: t })}
                className={`${github.tab} ${t === tab ? github.tabActive : ''}`}
                aria-current={t === tab ? 'page' : undefined}
              >
                {TAB_LABELS[t]}
              </Link>
            ))}
          </nav>

          {tab === 'repositories' ? (
            <section
              aria-labelledby="repos-title"
              className={`card ${github.panel}`}
            >
              <div className={github.panelHead}>
                <h2 id="repos-title">
                  Your repositories{' '}
                  <span className={github.count}>{repos.length}</span>
                </h2>
                <form
                  action="/dashboard/github"
                  method="get"
                  role="search"
                  className={github.search}
                >
                  <label htmlFor="repo-search" className={github.srOnly}>
                    Search repositories
                  </label>
                  <input
                    id="repo-search"
                    name="q"
                    type="search"
                    maxLength={100}
                    defaultValue={q}
                    placeholder="Search repositories…"
                  />
                  <label htmlFor="repo-sort">Sort by</label>
                  <select id="repo-sort" name="sort" defaultValue={sort}>
                    {SORTS.map((s) => (
                      <option key={s} value={s}>
                        {SORT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="button button-soft">
                    Apply
                  </button>
                </form>
              </div>

              {repos.length === 0 ? (
                <p className={github.fine}>
                  No repository is connected to a project yet. Link one on a
                  project&rsquo;s GitHub tab, or{' '}
                  <Link href="/dashboard/projects/new">
                    start a project from a repository
                  </Link>
                  .
                </p>
              ) : shown.length === 0 ? (
                <p className={github.fine}>
                  No repositories match your search.{' '}
                  <Link href={view({ q: '' })}>Clear the search</Link>
                </p>
              ) : (
                <ul className={github.repos}>
                  {shown.map((repo, index) => (
                    <RepoRow
                      key={`${String(repo.installationId)}:${repo.fullName}`}
                      repo={repo}
                      tone={TONES[index % TONES.length] ?? github.toneViolet}
                      selected={repo.fullName === selected?.fullName}
                      selectHref={view({ repo: repo.fullName })}
                      activityHref={view({
                        tab: 'commits',
                        repo: repo.fullName,
                      })}
                      nowMs={nowMs}
                    />
                  ))}
                </ul>
              )}
              {overview.unlinked > 0 ? (
                <p className={github.fine}>
                  {overview.unlinked === 1
                    ? '1 other repository the Shipnote app can see is not linked to a project, so it is not shown.'
                    : `${String(overview.unlinked)} other repositories the Shipnote app can see are not linked to a project, so they are not shown.`}
                </p>
              ) : null}
            </section>
          ) : null}

          <section
            aria-labelledby="activity-title"
            className={`card ${github.panel}`}
          >
            <div className={github.panelHead}>
              <div>
                <h2 id="activity-title">Recent activity</h2>
                <p className={github.fine}>
                  Commits you tagged <code>[post]</code>
                  {selected ? (
                    <>
                      {' '}
                      in <strong>{selected.name}</strong>
                    </>
                  ) : null}
                  , from the last 30 days.
                </p>
              </div>
            </div>
            <Suspense fallback={<p aria-live="polite">Loading activity</p>}>
              <Activity userId={user.id} repo={selected} nowMs={nowMs} />
            </Suspense>
          </section>
        </div>

        <aside
          className={shell.stack}
          aria-label="Repository details and actions"
        >
          {selected ? <RepoDetails repo={selected} /> : null}
          <QuickActions
            repo={selected}
            activityHref={view({ tab: 'commits' })}
          />
          <TipsCard />
        </aside>
      </div>
    </>
  )
}

function ConnectionCard({ account }: { account: GithubAccount }) {
  return (
    <section className={`card ${github.connection}`}>
      <span className={github.mark}>
        <Icon name="github" size={34} />
      </span>
      <div className={github.connectionText}>
        <p>
          Connected as <strong>{account.login}</strong>
        </p>
        <span className={github.connected}>Connected</span>
        {account.connectedAt ? (
          <p className={github.fine}>
            Since <DateText iso={account.connectedAt} />
          </p>
        ) : null}
      </div>
      <div className={github.connectionActions}>
        <a
          href={`https://github.com/${encodeURIComponent(account.login)}`}
          className="button button-soft"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="external" size={16} />
          View on GitHub
        </a>
        <DisconnectGithub
          action={disconnectGithubFromDashboardAction}
          installationId={account.installationId}
        />
      </div>
    </section>
  )
}

function RepoRow({
  repo,
  tone,
  selected,
  selectHref,
  activityHref,
  nowMs,
}: {
  repo: OverviewRepo
  tone: string
  selected: boolean
  selectHref: string
  activityHref: string
  nowMs: number
}) {
  return (
    <li className={`${github.repo} ${selected ? github.repoOn : ''}`}>
      <span className={`${github.repoIcon} ${tone}`}>
        <Icon name="code" size={20} />
      </span>
      <div className={github.repoBody}>
        <h3>
          <Link href={selectHref} aria-current={selected ? 'true' : undefined}>
            {repo.name}
          </Link>
        </h3>
        {repo.description ? <p>{repo.description}</p> : null}
        <p className={github.facts}>
          {repo.language ? (
            <span>
              <i
                className={github.dot}
                style={{ background: languageColor(repo.language) }}
                aria-hidden="true"
              />
              {repo.language}
            </span>
          ) : null}
          <span>
            <Icon name="star" size={14} /> {repo.stars}
            <span className={github.srOnly}> stars</span>
          </span>
          <span>
            <Icon name="fork" size={14} /> {repo.forks}
            <span className={github.srOnly}> forks</span>
          </span>
          <span>Updated {timeAgo(repo.updatedAt, nowMs)}</span>
        </p>
      </div>
      <Link href={activityHref} className={github.activityLink}>
        View activity
      </Link>
    </li>
  )
}

function RepoDetails({ repo }: { repo: OverviewRepo }) {
  return (
    <section
      className={`card ${github.details}`}
      aria-labelledby="details-title"
    >
      <div className={github.detailsHead}>
        <span className={`${github.repoIcon} ${github.toneViolet}`}>
          <Icon name="code" size={22} />
        </span>
        <h2 id="details-title">{repo.name}</h2>
        <span className={github.visibility}>
          {repo.isPrivate ? 'Private' : 'Public'}
        </span>
      </div>
      {repo.description ? (
        <p className={github.detailsText}>{repo.description}</p>
      ) : null}
      <dl className={github.stats}>
        <div>
          <dt>
            <Icon name="star" size={16} /> Stars
          </dt>
          <dd>{repo.stars}</dd>
        </div>
        <div>
          <dt>
            <Icon name="fork" size={16} /> Forks
          </dt>
          <dd>{repo.forks}</dd>
        </div>
        <div>
          <dt>
            <Icon name="note" size={16} /> Open issues
          </dt>
          <dd>{repo.openIssues}</dd>
        </div>
      </dl>
      <a
        href={repoUrl(repo.fullName)}
        className="button"
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="external" size={16} />
        Open in GitHub
      </a>
    </section>
  )
}

function QuickActions({
  repo,
  activityHref,
}: {
  repo: OverviewRepo | null
  activityHref: string
}) {
  const actions: {
    href: string
    icon: IconName
    title: string
    tone: string
  }[] = [
    {
      href: activityHref,
      icon: 'commit',
      title: 'View recent commits',
      tone: github.toneAzure,
    },
  ]
  if (repo && aiIsEnabled()) {
    actions.push({
      href: `/dashboard/projects/${repo.projectId}?tab=drafts`,
      icon: 'bolt',
      title: 'Generate post from activity',
      tone: github.toneViolet,
    })
  }

  return (
    <section className={`card ${shell.railCard}`} aria-labelledby="quick-title">
      <h2 id="quick-title" className={github.railTitle}>
        Quick actions
      </h2>
      <ul className={github.actions}>
        {actions.map((action) => (
          <li key={action.title}>
            <Link href={action.href} className={github.action}>
              <span className={`${github.actionIcon} ${action.tone}`}>
                <Icon name={action.icon} size={18} />
              </span>
              {action.title}
              <Icon name="chevron" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TipsCard() {
  return (
    <section
      className={`card ${shell.railCard} ${github.tips}`}
      aria-labelledby="tips-title"
    >
      <h2 id="tips-title" className={github.railTitle}>
        Tips for great posts
      </h2>
      <ul>
        {[
          'Tag meaningful commits with [post]',
          'Add context about the problem and the solution',
          'Highlight what you learned',
          'Include the tech and tools you used',
          'Keep it clear and professional',
        ].map((tip) => (
          <li key={tip}>
            <span className={shell.tick}>
              <Icon name="check" size={14} />
            </span>
            {tip}
          </li>
        ))}
      </ul>
    </section>
  )
}

// The [post] commits of the chosen repository, if it belongs to a project.
// Commit titles are untrusted text and are shown as plain text.
async function Activity({
  userId,
  repo,
  nowMs,
}: {
  userId: string
  repo: OverviewRepo | null
  nowMs: number
}) {
  if (!repo) {
    return (
      <p className={github.fine}>Choose a repository to see its activity.</p>
    )
  }
  const check = await checkPostCommits(userId, repo.projectId, nowMs)
  if (check.status !== 'ok') {
    const words: Record<Exclude<typeof check.status, 'ok'>, string> = {
      not_found: 'This project could not be found.',
      not_linked: 'This project is not linked to a repository.',
      reconnect: 'GitHub needs to be reconnected for this project.',
      repo_gone: 'GitHub no longer lets Shipnote see this repository.',
      rate_limited:
        'GitHub is limiting requests right now. Try again in a few minutes.',
      unavailable: 'We could not reach GitHub. Try again in a moment.',
      failed: 'Something went wrong. Try again.',
    }
    return <Notice tone="on-pink">{words[check.status]}</Notice>
  }
  if (check.commits.length === 0) {
    return (
      <p className={github.fine}>
        No commits tagged <code>[post]</code> in the last 30 days. Add{' '}
        <code>[post]</code> to a commit message and press Sync now.
      </p>
    )
  }

  const canDraft = aiIsEnabled()
  return (
    <ul className={github.activity}>
      {check.commits.map((commit) => (
        <li key={commit.sha}>
          <span className={`${github.repoIcon} ${github.toneViolet}`}>
            <Icon name="commit" size={18} />
          </span>
          <div className={github.activityBody}>
            <strong>{commit.title}</strong>
            <span>
              {repo.name} · {timeAgo(commit.date, nowMs)}
            </span>
          </div>
          <code>{commit.sha}</code>
          {canDraft ? (
            <Link
              href={`/dashboard/projects/${repo.projectId}?tab=drafts`}
              className={github.generate}
            >
              <Icon name="bolt" size={14} />
              Generate post
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
