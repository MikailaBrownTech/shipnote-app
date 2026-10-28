import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { choosePage, cleanSearch, paginate } from '@/lib/posts'
import { PROJECT_LIMITS } from '@/lib/project-schema'
import {
  FILTER_LABELS,
  PROJECTS_PAGE,
  PROJECT_FILTERS,
  PROJECT_SORTS,
  SORT_LABELS,
  chooseFilter,
  chooseProjectSort,
  countByFilter,
  filterProjects,
  projectsHref,
  sortProjects,
} from '@/lib/projects-view'
import { listProjects } from '@/server/projects'
import styles from '../dashboard.module.css'
import { Icon } from '../icons'
import { PageIntro } from '../page-intro'
import { PagerLinks } from '../pager-links'
import { PageSkeleton } from '../skeleton'
import index from './projects-index.module.css'
import projectStyles from './projects.module.css'
import { ProjectRow } from './project-row'

export const metadata: Metadata = { title: 'Projects' }

export default function ProjectsPage({
  searchParams,
}: PageProps<'/dashboard/projects'>) {
  return (
    <main className={styles.main}>
      {/* Reads the session and the address, so it sits behind Suspense. */}
      <Suspense fallback={<PageSkeleton tabs rows={6} />}>
        <Projects searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Projects({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard/projects'>['searchParams']
}) {
  const user = await requireUser()
  const query = await searchParams
  const filter = chooseFilter(query.stage)
  const q = cleanSearch(query.q)
  const sort = chooseProjectSort(query.sort)

  const result = await listProjects(user.id)
  const projects = result.ok ? result.value : []
  const full = projects.length >= PROJECT_LIMITS.perUser

  const intro = (
    <PageIntro
      title="Projects"
      subtitle="Everything you are building, in one place."
    >
      {result.ok && !full ? (
        <Link href="/dashboard/projects/new" className="button">
          <Icon name="plus" size={18} />
          New project
        </Link>
      ) : null}
    </PageIntro>
  )

  if (!result.ok) {
    return (
      <>
        {intro}
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load your projects. Try again in a moment.
        </p>
      </>
    )
  }

  if (projects.length === 0) {
    return (
      <>
        {intro}
        <div className={`on-violet ${projectStyles.empty}`}>
          <h2>No projects yet</h2>
          <p>
            A project holds the notes Shipnote will turn into LinkedIn post
            drafts. Add one to get started.
          </p>
          <Link href="/dashboard/projects/new" className="button">
            New project
          </Link>
        </div>
      </>
    )
  }

  const counts = countByFilter(projects)
  const shown = sortProjects(filterProjects(projects, filter, q), sort)
  const paged = paginate(shown, choosePage(query.page), PROJECTS_PAGE)
  const view = (patch: Parameters<typeof projectsHref>[0]) =>
    projectsHref({ filter, q, sort, ...patch })

  return (
    <>
      {intro}

      {full ? (
        <p className={`on-amber ${projectStyles.notice}`}>
          You have reached the {PROJECT_LIMITS.perUser} project limit. Delete
          one to add another.
        </p>
      ) : null}

      <section className={`card ${index.panel}`} aria-label="Your projects">
        <nav aria-label="Project stage" className={index.tabs}>
          {PROJECT_FILTERS.map((f) => (
            <Link
              key={f}
              href={view({ filter: f, page: 1 })}
              className={`${index.tab} ${f === filter ? index.tabActive : ''}`}
              aria-current={f === filter ? 'page' : undefined}
            >
              {FILTER_LABELS[f]}
              <span className={index.count}>{counts[f]}</span>
            </Link>
          ))}
        </nav>

        <form
          action="/dashboard/projects"
          method="get"
          role="search"
          className={index.search}
        >
          {filter !== 'all' ? (
            <input type="hidden" name="stage" value={filter} />
          ) : null}
          <label htmlFor="project-search" className={index.srOnly}>
            Search projects
          </label>
          <input
            id="project-search"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={q}
            placeholder="Search projects…"
          />
          <label htmlFor="project-sort">Sort by</label>
          <select id="project-sort" name="sort" defaultValue={sort}>
            {PROJECT_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="button button-soft">
            Apply
          </button>
        </form>

        {shown.length === 0 ? (
          <p className={index.fine}>
            No projects match{q ? ' your search' : ' this stage'}.{' '}
            <Link href={projectsHref({})}>Show all projects</Link>
          </p>
        ) : (
          <ul className={projectStyles.rows}>
            {paged.items.map((project) => (
              <ProjectRow key={project.id} project={project} repo />
            ))}
          </ul>
        )}

        <PagerLinks
          page={paged.page}
          pages={paged.pages}
          total={paged.total}
          noun="projects"
          hrefFor={(page) => view({ page })}
        />
        <p className={index.fine}>
          {projects.length} of {PROJECT_LIMITS.perUser} projects used.
        </p>
      </section>
    </>
  )
}
