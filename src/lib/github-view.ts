// What the GitHub page does with the repositories it was given: search, sort,
// pick one, and say how long ago something was. Pure, so every rule is tested
// without GitHub or a server.
import { isRepoFullName } from './github-repo'

export type RepoItem = {
  fullName: string
  name: string
  description: string | null
  isPrivate: boolean
  language: string | null
  stars: number
  forks: number
  openIssues: number
  updatedAt: string | null
}

export const GITHUB_TABS = ['repositories', 'commits'] as const
export type GithubTab = (typeof GITHUB_TABS)[number]

export const TAB_LABELS: Record<GithubTab, string> = {
  repositories: 'Repositories',
  commits: 'Commits',
}

export const SORTS = ['updated', 'name', 'stars'] as const
export type RepoSort = (typeof SORTS)[number]

export const SORT_LABELS: Record<RepoSort, string> = {
  updated: 'Recently updated',
  name: 'Name',
  stars: 'Most stars',
}

export const MAX_SEARCH = 100

// Only a tab from the fixed list; anything else is the first one.
export function chooseGithubTab(value: unknown): GithubTab {
  return GITHUB_TABS.find((tab) => tab === value) ?? 'repositories'
}

export function chooseSort(value: unknown): RepoSort {
  return SORTS.find((sort) => sort === value) ?? 'updated'
}

// The search text: one line, trimmed, never long.
export function cleanSearch(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH)
}

// A repository chosen in the address, only if it is one of the user's own
// repositories (compared without regard to case). Anything else is nothing.
export function chooseRepo(
  value: unknown,
  repos: readonly RepoItem[],
): RepoItem | null {
  if (typeof value !== 'string' || !isRepoFullName(value)) return null
  const wanted = value.toLowerCase()
  return repos.find((repo) => repo.fullName.toLowerCase() === wanted) ?? null
}

// Repositories whose name or description contains the search text.
export function filterRepos(
  repos: readonly RepoItem[],
  search: string,
): RepoItem[] {
  const needle = search.toLowerCase()
  if (needle === '') return [...repos]
  return repos.filter(
    (repo) =>
      repo.fullName.toLowerCase().includes(needle) ||
      (repo.description?.toLowerCase().includes(needle) ?? false),
  )
}

const time = (iso: string | null) => {
  const ms = iso === null ? Number.NaN : Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

// A new list, never the one it was given. Ties keep the name order.
export function sortRepos(
  repos: readonly RepoItem[],
  sort: RepoSort,
): RepoItem[] {
  const byName = (a: RepoItem, b: RepoItem) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  return [...repos].sort((a, b) => {
    if (sort === 'name') return byName(a, b)
    if (sort === 'stars') return b.stars - a.stars || byName(a, b)
    return time(b.updatedAt) - time(a.updatedAt) || byName(a, b)
  })
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const plural = (n: number, unit: string) =>
  `${String(n)} ${unit}${n === 1 ? '' : 's'} ago`

// "just now", "5 minutes ago", "2 hours ago", "1 day ago", "3 weeks ago",
// "4 months ago", "2 years ago". A missing or unreadable time is "unknown",
// and one in the future is "just now".
export function timeAgo(iso: string | null, nowMs: number): string {
  if (iso === null) return 'unknown'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'
  const diff = nowMs - then
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  if (diff < 7 * DAY) return plural(Math.floor(diff / DAY), 'day')
  if (diff < 30 * DAY) return plural(Math.floor(diff / (7 * DAY)), 'week')
  if (diff < 365 * DAY) return plural(Math.floor(diff / (30 * DAY)), 'month')
  return plural(Math.floor(diff / (365 * DAY)), 'year')
}

// The address of this page, keeping only what differs from the defaults.
export function githubHref(view: {
  tab?: GithubTab
  q?: string
  sort?: RepoSort
  repo?: string | null
}): string {
  const params = new URLSearchParams()
  if (view.tab && view.tab !== 'repositories') params.set('tab', view.tab)
  if (view.q) params.set('q', view.q)
  if (view.sort && view.sort !== 'updated') params.set('sort', view.sort)
  if (view.repo) params.set('repo', view.repo)
  const query = params.toString()
  return query ? `/dashboard/github?${query}` : '/dashboard/github'
}
