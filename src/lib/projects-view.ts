// What the Projects page does with the projects it was given: filter by stage,
// search, sort, and count. Pure, so every rule is tested without a server.
import { STAGES, STAGE_LABELS, type Stage } from './project-schema'

export type ProjectItem = {
  id: string
  name: string
  summary: string | null
  stage: Stage
  updatedAt: string
  repoFullName: string | null
}

export const PROJECT_FILTERS = ['all', ...STAGES] as const
export type ProjectFilter = (typeof PROJECT_FILTERS)[number]

export const FILTER_LABELS: Record<ProjectFilter, string> = {
  all: 'All projects',
  idea: 'Ideas',
  in_progress: STAGE_LABELS.in_progress,
  shipped: STAGE_LABELS.shipped,
}

export const PROJECT_SORTS = ['updated', 'name', 'stage'] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

export const SORT_LABELS: Record<ProjectSort, string> = {
  updated: 'Recently updated',
  name: 'Name',
  stage: 'Stage',
}

export const PROJECTS_PAGE = 8

// Only a filter or sort from the fixed lists; anything else is the default.
export function chooseFilter(value: unknown): ProjectFilter {
  return PROJECT_FILTERS.find((filter) => filter === value) ?? 'all'
}

export function chooseProjectSort(value: unknown): ProjectSort {
  return PROJECT_SORTS.find((sort) => sort === value) ?? 'updated'
}

// How many projects are in each filter.
export function countByFilter(
  projects: readonly ProjectItem[],
): Record<ProjectFilter, number> {
  const counts: Record<ProjectFilter, number> = {
    all: projects.length,
    idea: 0,
    in_progress: 0,
    shipped: 0,
  }
  for (const project of projects) counts[project.stage] += 1
  return counts
}

// Projects in the stage (or all), whose name, summary or repository contains the
// search text, ignoring case.
export function filterProjects<T extends ProjectItem>(
  projects: readonly T[],
  filter: ProjectFilter,
  search: string,
): T[] {
  const needle = search.toLowerCase()
  return projects.filter((project) => {
    if (filter !== 'all' && project.stage !== filter) return false
    if (needle === '') return true
    return (
      project.name.toLowerCase().includes(needle) ||
      (project.summary?.toLowerCase().includes(needle) ?? false) ||
      (project.repoFullName?.toLowerCase().includes(needle) ?? false)
    )
  })
}

const STAGE_ORDER: Record<Stage, number> = {
  idea: 0,
  in_progress: 1,
  shipped: 2,
}

const time = (iso: string) => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

// A new list, never the one it was given. Ties keep the name order.
export function sortProjects<T extends ProjectItem>(
  projects: readonly T[],
  sort: ProjectSort,
): T[] {
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  return [...projects].sort((a, b) => {
    if (sort === 'name') return byName(a, b)
    if (sort === 'stage') {
      return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || byName(a, b)
    }
    return time(b.updatedAt) - time(a.updatedAt) || byName(a, b)
  })
}

// The address of the Projects page, keeping only what differs from the defaults.
export function projectsHref(view: {
  filter?: ProjectFilter
  q?: string
  sort?: ProjectSort
  page?: number
}): string {
  const params = new URLSearchParams()
  if (view.filter && view.filter !== 'all') params.set('stage', view.filter)
  if (view.q) params.set('q', view.q)
  if (view.sort && view.sort !== 'updated') params.set('sort', view.sort)
  if (view.page && view.page > 1) params.set('page', String(view.page))
  const query = params.toString()
  return query ? `/dashboard/projects?${query}` : '/dashboard/projects'
}
