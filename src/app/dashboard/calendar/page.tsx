import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import {
  calendarHref,
  cardTitle,
  chooseWeek,
  currentWeek,
  DAY_MS,
  groupByDay,
  timeOfDay,
  todayIso,
  weekAllowed,
  weekBounds,
  weekDays,
  weekLabel,
} from '@/lib/calendar'
import { aiIsEnabled } from '@/server/draft-generation'
import { listSchedulesBetween } from '@/server/scheduled-posts'
import { schedulingIsEnabled } from '@/server/scheduling'
import styles from '../dashboard.module.css'
import { Icon } from '../icons'
import { PageIntro } from '../page-intro'
import projectStyles from '../projects/projects.module.css'
import calendar from './calendar.module.css'

export const metadata: Metadata = { title: 'Calendar' }

export default function CalendarPage({
  searchParams,
}: PageProps<'/dashboard/calendar'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the address, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your calendar</p>}>
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
  canceled: calendar.scheduled,
} as const

const STATUS_WORDS = {
  scheduling: 'Scheduling',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  canceled: 'Canceled',
} as const

// The proxy also redirects, but this page checks the user itself.
async function Calendar({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard/calendar'>['searchParams']
}) {
  const user = await requireUser()
  const query = await searchParams
  const monday = chooseWeek(query.week)
  const now = currentWeek()
  const days = weekDays(monday)
  const { from, to } = weekBounds(monday)
  const posts = await listSchedulesBetween(user.id, from, to)
  const today = todayIso()

  const prev = monday - 7 * DAY_MS
  const next = monday + 7 * DAY_MS

  const intro = (
    <PageIntro
      title="Calendar"
      subtitle="See what is scheduled for LinkedIn, week by week. Times are in UTC."
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

  const grouped = groupByDay(posts, days)
  const count = posts.length

  return (
    <>
      {intro}

      {schedulingIsEnabled() ? null : (
        <p className={`on-azure ${projectStyles.notice}`}>
          Scheduling is switched off right now, so new posts cannot be
          scheduled. Posts you scheduled earlier still show here.
        </p>
      )}

      <section
        className={`card ${calendar.board}`}
        aria-labelledby="week-title"
      >
        <div className={calendar.toolbar}>
          <h2 id="week-title" className={calendar.range}>
            {weekLabel(monday)}
          </h2>
          <nav aria-label="Change week" className={calendar.nav}>
            {weekAllowed(prev) ? (
              <Link
                href={calendarHref(prev)}
                className={calendar.arrow}
                aria-label="Previous week"
              >
                <Icon name="chevronLeft" size={18} />
              </Link>
            ) : (
              <span className={calendar.arrow} aria-hidden="true" />
            )}
            {weekAllowed(next) ? (
              <Link
                href={calendarHref(next)}
                className={calendar.arrow}
                aria-label="Next week"
              >
                <Icon name="chevron" size={18} />
              </Link>
            ) : (
              <span className={calendar.arrow} aria-hidden="true" />
            )}
            <Link
              href="/dashboard/calendar"
              className={`${calendar.thisWeek} ${monday === now ? calendar.thisWeekOn : ''}`}
              aria-current={monday === now ? 'page' : undefined}
            >
              This week
            </Link>
          </nav>
        </div>

        <ol className={calendar.days}>
          {days.map((day) => {
            const list = grouped.get(day.iso) ?? []
            return (
              <li
                key={day.iso}
                className={`${calendar.day} ${day.iso === today ? calendar.today : ''}`}
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
                        <Link
                          href={`/dashboard/posts?sel=s:${post.id}`}
                          className={`${calendar.post} ${STATUS_CLASS[post.status]}`}
                        >
                          <strong>{cardTitle(post.body)}</strong>
                          <span className={calendar.time}>
                            <Icon name="calendar" size={13} />
                            {timeOfDay(post.scheduledFor)} UTC
                          </span>
                          <span className={calendar.state}>
                            {STATUS_WORDS[post.status]}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>

        {count === 0 ? (
          <p className={calendar.note}>
            Nothing is scheduled this week. Schedule a draft from a
            project&rsquo;s Drafts tab and it will show up here.
          </p>
        ) : (
          <p className={calendar.note}>
            {count === 1 ? '1 post' : `${String(count)} posts`} this week.
            Select one to open it in Posts.
          </p>
        )}
      </section>
    </>
  )
}
