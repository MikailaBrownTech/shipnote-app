import { describe, expect, it } from 'vitest'
import {
  chooseGithubTab,
  chooseRepo,
  chooseSort,
  cleanSearch,
  filterRepos,
  githubHref,
  sortRepos,
  timeAgo,
  type RepoItem,
} from './github-view'

const repo = (over: Partial<RepoItem> = {}): RepoItem => ({
  fullName: 'octo/alpha',
  name: 'alpha',
  description: null,
  isPrivate: false,
  language: null,
  stars: 0,
  forks: 0,
  openIssues: 0,
  updatedAt: null,
  ...over,
})

const repos = [
  repo({
    fullName: 'octo/proposal-generator',
    name: 'proposal-generator',
    description: 'Internal tool for ClearPath IT compliance services',
    stars: 12,
    updatedAt: '2026-10-27T10:00:00Z',
  }),
  repo({
    fullName: 'octo/maintenance-tracker',
    name: 'maintenance-tracker',
    description: 'Track and manage system maintenance tasks',
    stars: 8,
    updatedAt: '2026-10-26T10:00:00Z',
  }),
  repo({
    fullName: 'octo/epitrack',
    name: 'epitrack',
    description: 'Epidemic tracking and reporting dashboard',
    stars: 9,
    updatedAt: '2026-10-24T10:00:00Z',
  }),
  repo({ fullName: 'octo/no-date', name: 'no-date', stars: 9 }),
]

describe('reading the address', () => {
  it('takes a tab and a sort only from the fixed lists', () => {
    expect(chooseGithubTab('commits')).toBe('commits')
    expect(chooseSort('stars')).toBe('stars')
    for (const bad of [undefined, '', 'COMMITS', 'releases', ['commits'], 3]) {
      expect(chooseGithubTab(bad)).toBe('repositories')
      expect(chooseSort(bad)).toBe('updated')
    }
  })

  it('keeps the search to one short line', () => {
    expect(cleanSearch('  a \n b  ')).toBe('a b')
    expect(cleanSearch('x'.repeat(500))).toHaveLength(100)
    expect(cleanSearch(['a'])).toBe('')
    expect(cleanSearch(undefined)).toBe('')
  })

  it('chooses a repository only if it is one of the user’s own, ignoring case', () => {
    expect(chooseRepo('octo/epitrack', repos)?.name).toBe('epitrack')
    expect(chooseRepo('OCTO/EpiTrack', repos)?.name).toBe('epitrack')
    for (const bad of [
      'other/epitrack',
      'octo/missing',
      '../etc/passwd',
      'octo/epitrack/extra',
      '',
      undefined,
      ['octo/epitrack'],
    ]) {
      expect(chooseRepo(bad, repos)).toBeNull()
    }
  })
})

describe('filterRepos', () => {
  it('finds a repository by name or description, ignoring case', () => {
    expect(filterRepos(repos, 'EPI').map((r) => r.name)).toEqual([
      'epitrack',
      // "Epidemic" is in the description of epitrack only.
    ])
    expect(filterRepos(repos, 'compliance').map((r) => r.name)).toEqual([
      'proposal-generator',
    ])
    expect(filterRepos(repos, 'tracker').map((r) => r.name)).toEqual([
      'maintenance-tracker',
    ])
  })

  it('an empty search is everything, a miss is nothing, and the input is not changed', () => {
    expect(filterRepos(repos, '')).toHaveLength(4)
    expect(filterRepos(repos, 'zzz')).toEqual([])
    expect(repos).toHaveLength(4)
  })
})

describe('sortRepos', () => {
  it('recently updated first, with no date last', () => {
    expect(sortRepos(repos, 'updated').map((r) => r.name)).toEqual([
      'proposal-generator',
      'maintenance-tracker',
      'epitrack',
      'no-date',
    ])
  })

  it('by name', () => {
    expect(sortRepos(repos, 'name').map((r) => r.name)).toEqual([
      'epitrack',
      'maintenance-tracker',
      'no-date',
      'proposal-generator',
    ])
  })

  it('by stars, ties by name', () => {
    expect(sortRepos(repos, 'stars').map((r) => r.name)).toEqual([
      'proposal-generator',
      'epitrack',
      'no-date',
      'maintenance-tracker',
    ])
  })

  it('returns a new list and leaves the original alone', () => {
    const before = repos.map((r) => r.name)
    const sorted = sortRepos(repos, 'name')
    expect(sorted).not.toBe(repos)
    expect(repos.map((r) => r.name)).toEqual(before)
  })
})

describe('timeAgo', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z')
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it.each([
    [10_000, 'just now'],
    [MIN, '1 minute ago'],
    [5 * MIN, '5 minutes ago'],
    [HOUR, '1 hour ago'],
    [2 * HOUR, '2 hours ago'],
    [DAY, '1 day ago'],
    [3 * DAY, '3 days ago'],
    [7 * DAY, '1 week ago'],
    [21 * DAY, '3 weeks ago'],
    [30 * DAY, '1 month ago'],
    [120 * DAY, '4 months ago'],
    [365 * DAY, '1 year ago'],
    [800 * DAY, '2 years ago'],
  ])('%i ms ago is “%s”', (ms, words) => {
    expect(timeAgo(ago(ms), NOW)).toBe(words)
  })

  it('a missing, unreadable or future time is handled plainly', () => {
    expect(timeAgo(null, NOW)).toBe('unknown')
    expect(timeAgo('not a date', NOW)).toBe('unknown')
    expect(timeAgo(new Date(NOW + HOUR).toISOString(), NOW)).toBe('just now')
  })
})

describe('githubHref', () => {
  it('keeps only what differs from the defaults', () => {
    expect(githubHref({})).toBe('/dashboard/github')
    expect(githubHref({ tab: 'repositories', sort: 'updated', q: '' })).toBe(
      '/dashboard/github',
    )
    expect(
      githubHref({
        tab: 'commits',
        q: 'a b',
        sort: 'name',
        repo: 'octo/epitrack',
      }),
    ).toBe('/dashboard/github?tab=commits&q=a+b&sort=name&repo=octo%2Fepitrack')
  })
})

describe('languageColor', () => {
  it('has a fixed colour for known languages, ignoring case, and grey for the rest', async () => {
    const { languageColor } = await import('./github-view')
    expect(languageColor('TypeScript')).toBe('#3178c6')
    expect(languageColor('python')).toBe('#3572a5')
    expect(languageColor('Brainfuck')).toBe('#9a95b0')
    expect(languageColor(null)).toBe('#9a95b0')
    // Never anything that could be markup or a style.
    expect(languageColor('red;background:url(x)')).toBe('#9a95b0')
    for (const name of ['TypeScript', 'Go', 'Rust', 'nope', null]) {
      expect(languageColor(name)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('githubHref activity pages', () => {
  it('names the page only after the first', () => {
    expect(githubHref({ ap: 1 })).toBe('/dashboard/github')
    expect(githubHref({ ap: 0 })).toBe('/dashboard/github')
    expect(githubHref({ ap: 3, repo: 'octo/x' })).toBe(
      '/dashboard/github?repo=octo%2Fx&ap=3',
    )
  })
})
