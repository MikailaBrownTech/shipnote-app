// The Posts page's list: a user's drafts and schedules, merged into one list.
// Pure functions, so the rules (what counts as which tab, what is hidden, how
// pages are cut) are tested without a database.

export type PostStatus =
  | 'draft'
  | 'copied'
  | 'scheduling'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'canceled'

export type DraftInput = {
  id: string
  projectId: string
  body: string
  status: 'draft' | 'copied'
  createdAt: string
}

export type ScheduleInput = {
  id: string
  projectId: string | null
  draftId: string | null
  body: string
  status: 'scheduling' | 'scheduled' | 'canceled' | 'failed' | 'published'
  scheduledFor: string
  createdAt: string
}

export type PostRow = {
  // 'd:<id>' for a draft, 's:<id>' for a schedule. Used in the page address.
  key: string
  kind: 'draft' | 'schedule'
  projectId: string | null
  projectName: string | null
  body: string
  status: PostStatus
  // When it goes out (or went out); null for a draft.
  scheduledFor: string | null
  createdAt: string
}

export const POST_TABS = [
  'all',
  'drafts',
  'scheduled',
  'published',
  'failed',
] as const
export type PostTab = (typeof POST_TABS)[number]

export const TAB_LABELS: Record<PostTab, string> = {
  all: 'All posts',
  drafts: 'Drafts',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
}

export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  copied: 'Copied',
  scheduling: 'Scheduling',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  canceled: 'Canceled',
}

export const PAGE_SIZE = 8
export const MAX_SEARCH = 100

const TAB_STATUSES: Record<Exclude<PostTab, 'all'>, PostStatus[]> = {
  drafts: ['draft', 'copied'],
  scheduled: ['scheduling', 'scheduled'],
  published: ['published'],
  failed: ['failed'],
}

// Only a tab from the fixed list; anything else is "all".
export function chooseTab(value: unknown): PostTab {
  return POST_TABS.find((tab) => tab === value) ?? 'all'
}

// A page number: a plain positive whole number, otherwise 1.
export function choosePage(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) return 1
  return Math.max(1, Number(value))
}

// The search text: one line, trimmed, never long.
export function cleanSearch(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH)
}

const KEY =
  /^[ds]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// A selection from the address, only if it has the shape of one of our keys.
export function chooseKey(value: unknown): string | null {
  return typeof value === 'string' && KEY.test(value) ? value : null
}

// Drafts and schedules as one list, newest first. A draft that has a schedule
// that is waiting or done is shown as that schedule, not twice. A failed or
// canceled schedule leaves its draft in the list so it can be tried again.
export function mergePosts(input: {
  drafts: DraftInput[]
  schedules: ScheduleInput[]
  projectNames: ReadonlyMap<string, string>
}): PostRow[] {
  const name = (projectId: string | null) =>
    projectId === null ? null : (input.projectNames.get(projectId) ?? null)

  const taken = new Set(
    input.schedules
      .filter((s) => s.status !== 'failed' && s.status !== 'canceled')
      .map((s) => s.draftId)
      .filter((id): id is string => id !== null),
  )

  const rows: PostRow[] = [
    ...input.drafts
      .filter((draft) => !taken.has(draft.id))
      .map((draft): PostRow => ({
        key: `d:${draft.id}`,
        kind: 'draft',
        projectId: draft.projectId,
        projectName: name(draft.projectId),
        body: draft.body,
        status: draft.status,
        scheduledFor: null,
        createdAt: draft.createdAt,
      })),
    ...input.schedules.map((schedule): PostRow => ({
      key: `s:${schedule.id}`,
      kind: 'schedule',
      projectId: schedule.projectId,
      projectName: name(schedule.projectId),
      body: schedule.body,
      status: schedule.status,
      scheduledFor: schedule.scheduledFor,
      createdAt: schedule.createdAt,
    })),
  ]
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function countByTab(rows: PostRow[]): Record<PostTab, number> {
  const counts: Record<PostTab, number> = {
    all: rows.length,
    drafts: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
  }
  for (const row of rows) {
    for (const tab of Object.keys(TAB_STATUSES) as Exclude<PostTab, 'all'>[]) {
      if (TAB_STATUSES[tab].includes(row.status)) counts[tab] += 1
    }
  }
  return counts
}

// The rows of a tab whose text or project name contains the search text.
export function filterPosts(
  rows: PostRow[],
  tab: PostTab,
  search: string,
): PostRow[] {
  const needle = search.toLowerCase()
  return rows.filter((row) => {
    if (tab !== 'all' && !TAB_STATUSES[tab].includes(row.status)) return false
    if (needle === '') return true
    return (
      row.body.toLowerCase().includes(needle) ||
      (row.projectName?.toLowerCase().includes(needle) ?? false)
    )
  })
}

export type Paged<T> = {
  items: T[]
  page: number
  pages: number
  total: number
}

// A page of a list. A page past the end is the last page.
export function paginate<T>(
  rows: T[],
  requested: number,
  size = PAGE_SIZE,
): Paged<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const page = Math.min(Math.max(1, requested), pages)
  return {
    items: rows.slice((page - 1) * size, page * size),
    page,
    pages,
    total: rows.length,
  }
}

// The first line of a post, short, for a list row.
export function postTitle(body: string, max = 70): string {
  const line =
    body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? ''
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}
