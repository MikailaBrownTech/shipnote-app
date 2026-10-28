import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import {
  calendarHref,
  cardTitle,
  chooseAnchor,
  choosePostId,
  chooseView,
  dayAllowed,
  groupByDay,
  monthWeeks,
  periodLabel,
  rangeFor,
  samePeriod,
  shiftAnchor,
  timeOfDay,
  todayIso,
  todayStart,
  weekDays,
  parseDay,
  type CalendarDay,
  type CalendarView,
} from '@/lib/calendar'
import { STATUS_LABELS } from '@/lib/posts'
import { aiIsEnabled } from '@/server/draft-generation'
import { listProjects } from '@/server/projects'
import { syncDueSchedules } from '@/server/schedule-sync'
import {
  getScheduledPost,
  listSchedulesBetween,
  type ScheduledPost,
} from '@/server/scheduled-posts'
import { schedulingIsEnabled } from '@/server/scheduling'
import styles from '../dashboard.module.css'
import { Icon } from '../icons'
import { LinkedinPreview } from '../linkedin-preview'
import { PageIntro } from '../page-intro'
import projectStyles from '../projects/projects.module.css'
import { DateText } from '../projects/stage-badge'
import calendar from './calendar.module.css'
import { PageSkeleton } from '../skeleton'

export const metadata: Metadata = { title: 'Calendar' }

export default function CalendarPage({
  searchParams,
}: PageProps<'/dashboard/calendar'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the address, so it sits behind Suspense. */}
      <Suspense fallback={<PageSkeleton rows={6} side />}>
        <Calendar searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

const STATUS_CLASS = {
  scheduling: calendar.scheduling,
  scheduled: calendar.scheduled,
  published: calendar.published,
  failed: calendar.failed,
  canceled: calendar.canceled,
} as const

// The most cards one day of the month grid shows; the rest are a link.
const MONTH_CARDS = 3

// The proxy also redirects, but this page checks the user itself.
async function Calendar({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard/calendar'>['searchParams']
}) {
  const user = await requireUser()
  const query = await searchParams
  const view = chooseView(query.view)
  const anchor = chooseAnchor(query.date)
  const today = todayStart()
  const { from, to } = rangeFor(view, anchor)

  // Posts whose time has passed are checked with Buffer first, so a published
  // or failed post shows as such.
  await syncDueSchedules(user.id)

  const [posts, projects] = await Promise.all([
    listSchedulesBetween(user.id, from, to),
    listProjects(user.id),
  ])

  const intro = (
    <PageIntro
      title="Calendar"
      subtitle="See what is scheduled for LinkedIn, by week or by month. Times are in UTC."
    >
      {aiIsEnabled() ? (
        <Link href="/dashboard#projects-title" className="button">
          <Icon name="plus" size={18} />
          New post
        </Link>
      ) : null}
    </PageIntro>
  )

  if (posts === null) {
    return (
      <>
        {intro}
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load your calendar. Try again in a moment.
        </p>
      </>
    )
  }

  const names = new Map(
    projects.ok ? projects.value.map((p) => [p.id, p.name]) : [],
  )

  // The post to preview: the one named in the address, which may be outside the
  // days shown; otherwise the first post shown. Only the user's own are found.
  const wanted = choosePostId(query.post)
  let selected: ScheduledPost | null =
    posts.find((post) => post.id === wanted) ?? null
  if (wanted !== null && selected === null) {
    const found = await getScheduledPost(user.id, wanted)
    selected = typeof found === 'string' ? null : found
  }
  if (wanted === null) selected = posts.at(0) ?? null

  const link = (target: {
    view?: CalendarView
    anchor?: number
    post?: string | null
  }) =>
    calendarHref({
      view: target.view ?? view,
      anchor: target.anchor ?? anchor,
      post: target.post ?? null,
    })

  const prev = shiftAnchor(view, anchor, -1)
  const next = shiftAnchor(view, anchor, 1)
  const days: CalendarDay[] = view === 'week' ? weekDays(anchor) : []
  const weeks = view === 'month' ? monthWeeks(anchor) : []
  const grouped = groupByDay(posts, view === 'week' ? days : weeks.flat())
  const inPeriod = posts.filter((post) => {
    const ms = Date.parse(post.scheduledFor)
    return !Number.isNaN(ms) && ms >= Date.parse(from) && ms < Date.parse(to)
  }).length
  const todayKey = todayIso()

  return (
    <>
      {intro}

      {schedulingIsEnabled() ? null : (
        <p className={`on-azure ${projectStyles.notice}`}>
          Scheduling is switched off right now, so new posts cannot be
          scheduled. Posts you scheduled earlier still show here.
        </p>
      )}

      <div className={calendar.layout}>
        <section
          className={`card ${calendar.board}`}
          aria-labelledby="period-title"
        >
          <div className={calendar.toolbar}>
            <h2 id="period-title" className={calendar.range}>
              {periodLabel(view, anchor)}
            </h2>
            <div className={calendar.controls}>
              <nav aria-label="Calendar view" className={calendar.views}>
                {(['week', 'month'] as const).map((v) => (
                  <Link
                    key={v}
                    href={link({ view: v })}
                    className={`${calendar.viewLink} ${v === view ? calendar.viewOn : ''}`}
                    aria-current={v === view ? 'page' : undefined}
                  >
                    {v === 'week' ? 'Week' : 'Month'}
                  </Link>
                ))}
              </nav>
              <nav
                aria-label={view === 'week' ? 'Change week' : 'Change month'}
                className={calendar.nav}
              >
                {dayAllowed(prev) ? (
                  <Link
                    href={link({ anchor: prev })}
                    className={calendar.arrow}
                    aria-label={
                      view === 'week' ? 'Previous week' : 'Previous month'
                    }
                  >
                    <Icon name="chevronLeft" size={18} />
                  </Link>
                ) : (
                  <span className={calendar.arrow} aria-hidden="true" />
                )}
                {dayAllowed(next) ? (
                  <Link
                    href={link({ anchor: next })}
                    className={calendar.arrow}
                    aria-label={view === 'week' ? 'Next week' : 'Next month'}
                  >
                    <Icon name="chevron" size={18} />
                  </Link>
                ) : (
                  <span className={calendar.arrow} aria-hidden="true" />
                )}
                <Link
                  href={link({ anchor: today })}
                  className={`${calendar.thisWeek} ${samePeriod(view, anchor, today) ? calendar.thisWeekOn : ''}`}
                  aria-current={
                    samePeriod(view, anchor, today) ? 'page' : undefined
                  }
                >
                  {view === 'week' ? 'This week' : 'This month'}
                </Link>
              </nav>
            </div>
          </div>

          {view === 'week' ? (
            <ol className={calendar.days}>
              {days.map((day) => {
                const list = grouped.get(day.iso) ?? []
                return (
                  <li
                    key={day.iso}
                    className={`${calendar.day} ${day.iso === todayKey ? calendar.today : ''}`}
                    aria-label={`${day.weekday} ${String(day.day)}`}
                  >
                    <p className={calendar.dayHead}>
                      <span>{day.weekday}</span>
                      <strong>{day.day}</strong>
                    </p>
                    {list.length === 0 ? (
                      <p className={calendar.empty}>Nothing scheduled</p>
                    ) : (
                      <ul className={calendar.posts}>
                        {list.map((post) => (
                          <li key={post.id}>
                            <PostCard
                              post={post}
                              href={link({ post: post.id })}
                              selected={post.id === selected?.id}
                              showStatus
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className={calendar.month} role="grid" aria-label="Month">
              <div className={calendar.weekdays} role="row">
                {weeks[0]?.map((d) => (
                  <span key={d.weekday} role="columnheader">
                    {d.weekday}
                  </span>
                ))}
              </div>
              {weeks.map((week) => (
                <div key={week[0]?.iso} className={calendar.weekRow} role="row">
                  {week.map((day) => {
                    const list = grouped.get(day.iso) ?? []
                    const dayMs = parseDay(day.iso) ?? anchor
                    return (
                      <div
                        key={day.iso}
                        role="gridcell"
                        className={`${calendar.cell} ${day.inMonth ? '' : calendar.outside} ${day.iso === todayKey ? calendar.today : ''}`}
                        aria-label={`${day.weekday} ${String(day.day)}${list.length > 0 ? `, ${String(list.length)} ${list.length === 1 ? 'post' : 'posts'}` : ''}`}
                      >
                        <Link
                          href={link({ view: 'week', anchor: dayMs })}
                          className={calendar.dayNum}
                          aria-label={`Show the week of ${day.weekday} ${String(day.day)}`}
                        >
                          {day.day}
                        </Link>
                        {list.length > 0 ? (
                          <span className={calendar.dots} aria-hidden="true">
                            {list.length}
                          </span>
                        ) : null}
                        <ul className={calendar.cellPosts}>
                          {list.slice(0, MONTH_CARDS).map((post) => (
                            <li key={post.id}>
                              <PostCard
                                post={post}
                                href={link({ post: post.id })}
                                selected={post.id === selected?.id}
                              />
                            </li>
                          ))}
                        </ul>
                        {list.length > MONTH_CARDS ? (
                          <Link
                            href={link({ view: 'week', anchor: dayMs })}
                            className={calendar.more}
                          >
                            +{list.length - MONTH_CARDS} more
                          </Link>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {inPeriod === 0 ? (
            <p className={calendar.note}>
              Nothing is scheduled{' '}
              {view === 'week' ? 'this week' : 'this month'}. Schedule a draft
              from a project&rsquo;s Drafts tab and it will show up here.
            </p>
          ) : (
            <p className={calendar.note}>
              {inPeriod === 1 ? '1 post' : `${String(inPeriod)} posts`}{' '}
              {view === 'week' ? 'this week' : 'this month'}. Select one to
              preview it.
            </p>
          )}
        </section>

        <aside aria-label="Post preview" className={`card ${calendar.preview}`}>
          <Preview post={selected} names={names} />
        </aside>
      </div>
    </>
  )
}

function PostCard({
  post,
  href,
  selected,
  showStatus = false,
}: {
  post: ScheduledPost
  href: string
  selected: boolean
  showStatus?: boolean
}) {
  return (
    <Link
      href={href}
      className={`${calendar.post} ${STATUS_CLASS[post.status]} ${selected ? calendar.postOn : ''}`}
      aria-current={selected ? 'true' : undefined}
    >
      <strong>{cardTitle(post.body)}</strong>
      <span className={calendar.time}>
        <Icon name="calendar" size={13} />
        {timeOfDay(post.scheduledFor)} UTC
      </span>
      {showStatus ? (
        <span className={calendar.state}>{STATUS_LABELS[post.status]}</span>
      ) : null}
    </Link>
  )
}

// A scheduled post as it will read on LinkedIn, with when and where it goes.
// Plain text only. It changes nothing: editing and cancelling are on the
// project's Drafts tab.
function Preview({
  post,
  names,
}: {
  post: ScheduledPost | null
  names: ReadonlyMap<string, string>
}) {
  if (!post) {
    return (
      <>
        <h2 className={calendar.previewTitle}>Post preview</h2>
        <p className={calendar.note}>Select a post to preview it.</p>
      </>
    )
  }
  const project = post.projectId ? (names.get(post.projectId) ?? null) : null
  return (
    <>
      <div className={calendar.previewHead}>
        <h2 className={calendar.previewTitle}>Post preview</h2>
        <span className={`${calendar.chip} ${STATUS_CLASS[post.status]}`}>
          {STATUS_LABELS[post.status]}
        </span>
      </div>
      <p className={calendar.previewMeta}>
        <span>
          <Icon name="calendar" size={14} />{' '}
          <DateText iso={post.scheduledFor} />, {timeOfDay(post.scheduledFor)}{' '}
          UTC
        </span>
        {post.channelLabel ? <span>To {post.channelLabel}</span> : null}
        <span>{project ?? 'Deleted project'}</span>
      </p>
      <LinkedinPreview
        body={post.body}
        name={post.channelLabel}
        when={`${timeOfDay(post.scheduledFor)} UTC`}
      />
      <p className={calendar.note}>
        {post.body.length.toLocaleString('en')}/3,000
      </p>
      {post.status === 'failed' ? (
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          This post could not be scheduled. Open the project&rsquo;s Drafts tab
          to try again.
        </p>
      ) : null}
      <div className={calendar.previewActions}>
        <Link
          href={`/dashboard/posts?sel=s:${post.id}`}
          className="button button-soft"
        >
          Open in Posts
        </Link>
        {post.projectId ? (
          <Link
            href={`/dashboard/projects/${post.projectId}?tab=drafts`}
            className="button"
          >
            Open project
            <Icon name="arrowRight" size={16} />
          </Link>
        ) : null}
      </div>
      <p className={calendar.note}>
        Scheduled posts are sent by Buffer at the time shown. To change or
        cancel one, use the project&rsquo;s Drafts tab. Shipnote never posts for
        you.
      </p>
    </>
  )
}
