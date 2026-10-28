import { describe, expect, it } from 'vitest'
import {
  PAGE_SIZE,
  chooseKey,
  choosePage,
  chooseTab,
  cleanSearch,
  countByTab,
  filterPosts,
  mergePosts,
  paginate,
  postTitle,
  type DraftInput,
  type ScheduleInput,
} from './posts'

const P1 = '11111111-2222-4333-8444-555555555555'
const names = new Map([[P1, 'Proposal Generator']])

const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  id: 'aaaaaaaa-2222-4333-8444-555555555555',
  projectId: P1,
  body: 'A plain draft',
  status: 'draft',
  createdAt: '2026-10-27T09:00:00Z',
  ...over,
})

const schedule = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  id: 'bbbbbbbb-2222-4333-8444-555555555555',
  projectId: P1,
  draftId: null,
  body: 'A scheduled post',
  status: 'scheduled',
  scheduledFor: '2026-10-30T10:00:00Z',
  createdAt: '2026-10-27T10:00:00Z',
  ...over,
})

const merge = (drafts: DraftInput[], schedules: ScheduleInput[]) =>
  mergePosts({ drafts, schedules, projectNames: names })

describe('the address', () => {
  it('takes a tab only from the fixed list', () => {
    expect(chooseTab('failed')).toBe('failed')
    for (const bad of [undefined, '', 'FAILED', 'canceled', ['all'], 3]) {
      expect(chooseTab(bad)).toBe('all')
    }
  })

  it('takes a page only as a plain positive number', () => {
    expect(choosePage('3')).toBe(3)
    for (const bad of [undefined, '', '0', '-2', '1.5', 'x', '9'.repeat(7)]) {
      expect(choosePage(bad)).toBe(1)
    }
  })

  it('keeps a search to one short line', () => {
    expect(cleanSearch('  a \n\n b  ')).toBe('a b')
    expect(cleanSearch('x'.repeat(500))).toHaveLength(100)
    expect(cleanSearch(['a'])).toBe('')
    expect(cleanSearch(undefined)).toBe('')
  })

  it('takes a selection only in the shape of one of our keys', () => {
    expect(chooseKey(`d:${P1}`)).toBe(`d:${P1}`)
    expect(chooseKey(`s:${P1}`)).toBe(`s:${P1}`)
    for (const bad of [
      'x:' + P1,
      `d:${P1}x`,
      'd:1',
      '',
      undefined,
      `D:${P1}`,
    ]) {
      expect(chooseKey(bad)).toBeNull()
    }
  })
})

describe('mergePosts', () => {
  it('lists drafts and schedules together, newest first, with project names', () => {
    const rows = merge([draft()], [schedule()])
    expect(rows.map((r) => r.key)).toEqual(
      [
        'd:' + 'aaaaaaaa-2222-4333-8444-555555555555'.slice(0),
        's:bbbbbbbb-2222-4333-8444-555555555555',
      ].reverse(),
    )
    expect(rows[0]).toMatchObject({
      kind: 'schedule',
      projectName: 'Proposal Generator',
      scheduledFor: '2026-10-30T10:00:00Z',
    })
    expect(rows[1]).toMatchObject({ kind: 'draft', scheduledFor: null })
  })

  it('shows a draft that is scheduled or published once, as the schedule', () => {
    for (const status of ['scheduling', 'scheduled', 'published'] as const) {
      const rows = merge([draft()], [schedule({ draftId: draft().id, status })])
      expect(rows).toHaveLength(1)
      expect(rows[0]?.kind).toBe('schedule')
    }
  })

  it('keeps the draft when its schedule failed or was canceled', () => {
    for (const status of ['failed', 'canceled'] as const) {
      const rows = merge([draft()], [schedule({ draftId: draft().id, status })])
      expect(rows.map((r) => r.kind).sort()).toEqual(['draft', 'schedule'])
    }
  })

  it('a project that is gone has no name', () => {
    const rows = merge([], [schedule({ projectId: null })])
    expect(rows[0]?.projectName).toBeNull()
    expect(
      merge([draft({ projectId: 'other' })], [])[0]?.projectName,
    ).toBeNull()
  })
})

describe('tabs, counts and search', () => {
  const rows = merge(
    [
      draft({ id: 'd1', body: 'Draft about notifications' }),
      draft({ id: 'd2', status: 'copied', createdAt: '2026-10-26T00:00:00Z' }),
    ],
    [
      schedule({ id: 's1', status: 'scheduling' }),
      schedule({ id: 's2', status: 'scheduled' }),
      schedule({ id: 's3', status: 'published' }),
      schedule({ id: 's4', status: 'failed' }),
      schedule({ id: 's5', status: 'canceled' }),
    ],
  )

  it('counts each tab; canceled counts only under all', () => {
    expect(countByTab(rows)).toEqual({
      all: 7,
      drafts: 2,
      scheduled: 2,
      published: 1,
      failed: 1,
    })
  })

  it('filters by tab', () => {
    expect(
      filterPosts(rows, 'drafts', '')
        .map((r) => r.status)
        .sort(),
    ).toEqual(['copied', 'draft'])
    expect(filterPosts(rows, 'scheduled', '')).toHaveLength(2)
    expect(filterPosts(rows, 'failed', '')).toHaveLength(1)
    expect(filterPosts(rows, 'all', '')).toHaveLength(7)
  })

  it('searches the post text and the project name, ignoring case', () => {
    expect(filterPosts(rows, 'all', 'NOTIFICATIONS')).toHaveLength(1)
    expect(filterPosts(rows, 'all', 'proposal')).toHaveLength(7)
    expect(filterPosts(rows, 'drafts', 'scheduled post')).toHaveLength(0)
    expect(filterPosts(rows, 'all', 'nothing like this')).toHaveLength(0)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 19 }, (_, i) => i)

  it('cuts pages and clamps the requested one', () => {
    expect(paginate(items, 1).items).toHaveLength(PAGE_SIZE)
    expect(paginate(items, 3)).toMatchObject({ page: 3, pages: 3, total: 19 })
    expect(paginate(items, 3).items).toEqual([16, 17, 18])
    expect(paginate(items, 99).page).toBe(3)
    expect(paginate(items, 0).page).toBe(1)
  })

  it('an empty list is one empty page', () => {
    expect(paginate([], 4)).toEqual({ items: [], page: 1, pages: 1, total: 0 })
  })
})

describe('postTitle', () => {
  it('is the first non-empty line, shortened', () => {
    expect(postTitle('\n\n  Hello world \nsecond')).toBe('Hello world')
    expect(postTitle('x'.repeat(200))).toHaveLength(70)
    expect(postTitle('x'.repeat(200)).endsWith('…')).toBe(true)
    expect(postTitle('')).toBe('')
  })
})
