import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import {
  PAGE_SIZE,
  POST_TABS,
  STATUS_LABELS,
  TAB_LABELS,
  chooseKey,
  choosePage,
  chooseTab,
  cleanSearch,
  countByTab,
  filterPosts,
  mergePosts,
  paginate,
  postTitle,
  type PostRow,
  type PostTab,
} from '@/lib/posts'
import { aiIsEnabled } from '@/server/draft-generation'
import { listProjects } from '@/server/projects'
import { listUserPosts } from '@/server/posts'
import styles from '../dashboard.module.css'
import { Icon } from '../icons'
import { PageIntro } from '../page-intro'
import projectStyles from '../projects/projects.module.css'
import { DateText } from '../projects/stage-badge'
import shell from '../shell.module.css'
import postStyles from './posts.module.css'

export const metadata: Metadata = { title: 'Posts' }

export default function PostsPage({
  searchParams,
}: PageProps<'/dashboard/posts'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the address, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your posts</p>}>
        <Posts searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

const timeFormat = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

// The time a post goes out, in UTC like every date in the app.
function When({ iso }: { iso: string | null }) {
  if (iso === null) return <span aria-label="No date">—</span>
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return <span aria-label="No date">—</span>
  return (
    <>
      <DateText iso={iso} />
      <br />
      <time dateTime={iso}>{timeFormat.format(date)} UTC</time>
    </>
  )
}

function StatusChip({ row }: { row: PostRow }) {
  return (
    <span className={`${postStyles.chip} ${postStyles[row.status]}`}>
      {STATUS_LABELS[row.status]}
    </span>
  )
}

type View = { tab: PostTab; q: string; page: number; sel: string | null }

// An address for this page, keeping only what differs from the defaults.
function href(view: View): string {
  const params = new URLSearchParams()
  if (view.tab !== 'all') params.set('tab', view.tab)
  if (view.q !== '') params.set('q', view.q)
  if (view.page > 1) params.set('page', String(view.page))
  if (view.sel) params.set('sel', view.sel)
  const query = params.toString()
  return query ? `/dashboard/posts?${query}` : '/dashboard/posts'
}

// The proxy also redirects, but this page checks the user itself.
async function Posts({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard/posts'>['searchParams']
}) {
  const user = await requireUser()
  const query = await searchParams
  const tab = chooseTab(query.tab)
  const q = cleanSearch(query.q)
  const requestedPage = choosePage(query.page)
  const requestedKey = chooseKey(query.sel)

  const [posts, projects] = await Promise.all([
    listUserPosts(user.id),
    listProjects(user.id),
  ])

  const intro = (
    <PageIntro
      title="Posts"
      subtitle="Manage your LinkedIn content across all projects."
    >
      {aiIsEnabled() ? (
        <Link href="/dashboard#projects-title" className="button">
          <Icon name="bolt" size={18} />
          Generate post
        </Link>
      ) : null}
    </PageIntro>
  )

  if (posts === null || !projects.ok) {
    return (
      <>
        {intro}
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load your posts. Try again in a moment.
        </p>
      </>
    )
  }

  const names = new Map(projects.value.map((p) => [p.id, p.name]))
  const all = mergePosts({
    drafts: posts.drafts,
    schedules: posts.schedules,
    projectNames: names,
  })
  const counts = countByTab(all)
  const shown = filterPosts(all, tab, q)
  const paged = paginate(shown, requestedPage)
  const selected =
    shown.find((row) => row.key === requestedKey) ?? paged.items.at(0) ?? null
  const view = (patch: Partial<View>): View => ({
    tab,
    q,
    page: paged.page,
    sel: null,
    ...patch,
  })

  return (
    <>
      {intro}

      <div className={postStyles.layout}>
        <section aria-label="Your posts" className={postStyles.listSide}>
          <nav aria-label="Post status" className={postStyles.tabs}>
            {POST_TABS.map((t) => (
              <Link
                key={t}
                href={href({ tab: t, q, page: 1, sel: null })}
                className={`${postStyles.tab} ${t === tab ? postStyles.tabActive : ''}`}
                aria-current={t === tab ? 'page' : undefined}
              >
                {TAB_LABELS[t]}
                <span className={postStyles.count}>{counts[t]}</span>
              </Link>
            ))}
          </nav>

          <form
            action="/dashboard/posts"
            method="get"
            role="search"
            className={postStyles.search}
          >
            {tab !== 'all' ? (
              <input type="hidden" name="tab" value={tab} />
            ) : null}
            <label htmlFor="post-search" className={postStyles.srOnly}>
              Search posts
            </label>
            <input
              id="post-search"
              name="q"
              type="search"
              maxLength={100}
              defaultValue={q}
              placeholder="Search posts…"
            />
            <button type="submit" className="button button-soft">
              Search
            </button>
          </form>

          {all.length === 0 ? (
            <div className={`on-violet ${projectStyles.empty}`}>
              <h2>No posts yet</h2>
              <p>
                Drafts and scheduled posts from all your projects will show up
                here. Open a project to write your first draft.
              </p>
              <Link href="/dashboard" className="button">
                Go to your projects
              </Link>
            </div>
          ) : shown.length === 0 ? (
            <p className={`on-azure ${projectStyles.notice}`}>
              No posts match{q ? ' your search' : ' this tab'}.
              {q ? (
                <>
                  {' '}
                  <Link href={href({ tab, q: '', page: 1, sel: null })}>
                    Clear the search
                  </Link>
                </>
              ) : null}
            </p>
          ) : (
            <>
              <ul className={`card ${postStyles.rows}`}>
                {paged.items.map((row) => (
                  <li
                    key={row.key}
                    className={`${postStyles.row} ${row.key === selected?.key ? postStyles.rowActive : ''}`}
                  >
                    <Link
                      href={href(view({ sel: row.key }))}
                      className={postStyles.rowLink}
                      aria-current={
                        row.key === selected?.key ? 'true' : undefined
                      }
                    >
                      <span className={postStyles.rowTitle}>
                        {postTitle(row.body)}
                      </span>
                      <span className={postStyles.rowProject}>
                        {row.projectName ?? 'Deleted project'}
                      </span>
                      <StatusChip row={row} />
                      <span className={postStyles.rowWhen}>
                        <When iso={row.scheduledFor} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className={postStyles.pager}>
                <p>
                  {paged.total === 1
                    ? '1 post'
                    : `${String(paged.total)} posts`}
                  {paged.pages > 1 ? `, ${String(PAGE_SIZE)} per page` : ''}
                </p>
                {paged.pages > 1 ? (
                  <nav aria-label="Pages">
                    {paged.page > 1 ? (
                      <Link
                        href={href(view({ page: paged.page - 1 }))}
                        aria-label="Previous page"
                        className={postStyles.pageLink}
                      >
                        <span className={postStyles.flip}>
                          <Icon name="chevron" size={16} />
                        </span>
                      </Link>
                    ) : null}
                    <span aria-current="page" className={postStyles.pageNow}>
                      Page {paged.page} of {paged.pages}
                    </span>
                    {paged.page < paged.pages ? (
                      <Link
                        href={href(view({ page: paged.page + 1 }))}
                        aria-label="Next page"
                        className={postStyles.pageLink}
                      >
                        <Icon name="chevron" size={16} />
                      </Link>
                    ) : null}
                  </nav>
                ) : null}
              </div>
              {posts.truncated ? (
                <p className={postStyles.fine}>
                  Showing your newest posts. Older ones are in their projects.
                </p>
              ) : null}
            </>
          )}
        </section>

        <aside
          aria-label="Post preview"
          className={`card ${shell.railCard} ${postStyles.preview}`}
        >
          <div className={postStyles.previewHead}>
            <h2>Post preview</h2>
            {selected ? <StatusChip row={selected} /> : null}
          </div>
          {selected ? (
            <>
              <p className={postStyles.previewMeta}>
                {selected.projectName ?? 'Deleted project'}
                {selected.scheduledFor ? (
                  <>
                    {' · '}
                    <When iso={selected.scheduledFor} />
                  </>
                ) : null}
              </p>
              <div className={postStyles.body}>{selected.body}</div>
              <p className={postStyles.fine}>
                {selected.body.length.toLocaleString('en')}/3,000
              </p>
              {selected.projectId ? (
                <Link
                  href={`/dashboard/projects/${selected.projectId}?tab=drafts`}
                  className="button"
                >
                  Open in project
                  <Icon name="arrowRight" size={16} />
                </Link>
              ) : null}
              <p className={postStyles.fine}>
                Edit, schedule or copy a post from its project&rsquo;s Drafts
                tab. Shipnote never posts for you.
              </p>
            </>
          ) : (
            <p className={postStyles.fine}>Select a post to preview it.</p>
          )}
        </aside>
      </div>
    </>
  )
}
