import { describe, expect, it } from 'vitest'
import {
  chooseFilter,
  chooseProjectSort,
  countByFilter,
  filterProjects,
  projectsHref,
  sortProjects,
  type ProjectItem,
} from './projects-view'

const project = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: 'p',
  name: 'Alpha',
  summary: null,
  stage: 'idea',
  updatedAt: '2026-10-20T10:00:00Z',
  repoFullName: null,
  ...over,
})

const projects: ProjectItem[] = [
  project({
    id: '1',
    name: 'Proposal Generator',
    summary: 'Internal tool for ClearPath IT compliance',
    stage: 'in_progress',
    updatedAt: '2026-10-27T10:00:00Z',
    repoFullName: 'octo/proposal-generator',
  }),
  project({
    id: '2',
    name: 'Maintenance Tracker',
    summary: 'Track system maintenance tasks',
    stage: 'in_progress',
    updatedAt: '2026-10-26T10:00:00Z',
  }),
  project({
    id: '3',
    name: 'EpiTrack',
    summary: 'Epidemic tracking dashboard',
    stage: 'shipped',
    updatedAt: '2026-10-24T10:00:00Z',
    repoFullName: 'octo/epitrack',
  }),
  project({ id: '4', name: 'Idea Box', stage: 'idea', updatedAt: 'nope' }),
]

describe('reading the address', () => {
  it('takes a filter and a sort only from the fixed lists', () => {
    expect(chooseFilter('shipped')).toBe('shipped')
    expect(chooseProjectSort('stage')).toBe('stage')
    for (const bad of [undefined, '', 'SHIPPED', 'done', ['shipped'], 3]) {
      expect(chooseFilter(bad)).toBe('all')
      expect(chooseProjectSort(bad)).toBe('updated')
    }
  })
})

describe('countByFilter', () => {
  it('counts each stage and all of them', () => {
    expect(countByFilter(projects)).toEqual({
      all: 4,
      idea: 1,
      in_progress: 2,
      shipped: 1,
    })
    expect(countByFilter([])).toEqual({
      all: 0,
      idea: 0,
      in_progress: 0,
      shipped: 0,
    })
  })
})

describe('filterProjects', () => {
  it('filters by stage', () => {
    expect(
      filterProjects(projects, 'in_progress', '').map((p) => p.id),
    ).toEqual(['1', '2'])
    expect(filterProjects(projects, 'all', '')).toHaveLength(4)
  })

  it('searches the name, the summary and the repository, ignoring case', () => {
    expect(filterProjects(projects, 'all', 'EPI').map((p) => p.id)).toEqual([
      '3',
    ])
    expect(
      filterProjects(projects, 'all', 'compliance').map((p) => p.id),
    ).toEqual(['1'])
    expect(
      filterProjects(projects, 'all', 'octo/epitrack').map((p) => p.id),
    ).toEqual(['3'])
  })

  it('a stage and a search together both apply, and a miss is nothing', () => {
    expect(
      filterProjects(projects, 'shipped', 'track').map((p) => p.id),
    ).toEqual(['3'])
    expect(filterProjects(projects, 'idea', 'track')).toEqual([])
    expect(filterProjects(projects, 'all', 'zzz')).toEqual([])
  })

  it('does not change the list it was given', () => {
    const before = projects.map((p) => p.id)
    filterProjects(projects, 'idea', 'box')
    expect(projects.map((p) => p.id)).toEqual(before)
  })
})

describe('sortProjects', () => {
  it('recently updated first, with an unreadable date last', () => {
    expect(sortProjects(projects, 'updated').map((p) => p.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
  })

  it('by name, ignoring case', () => {
    expect(sortProjects(projects, 'name').map((p) => p.name)).toEqual([
      'EpiTrack',
      'Idea Box',
      'Maintenance Tracker',
      'Proposal Generator',
    ])
  })

  it('by stage (idea, in progress, shipped), ties by name', () => {
    expect(sortProjects(projects, 'stage').map((p) => p.name)).toEqual([
      'Idea Box',
      'Maintenance Tracker',
      'Proposal Generator',
      'EpiTrack',
    ])
  })

  it('returns a new list and leaves the original alone', () => {
    const before = projects.map((p) => p.id)
    const sorted = sortProjects(projects, 'name')
    expect(sorted).not.toBe(projects)
    expect(projects.map((p) => p.id)).toEqual(before)
  })
})

describe('projectsHref', () => {
  it('keeps only what differs from the defaults', () => {
    expect(projectsHref({})).toBe('/dashboard/projects')
    expect(
      projectsHref({ filter: 'all', q: '', sort: 'updated', page: 1 }),
    ).toBe('/dashboard/projects')
    expect(
      projectsHref({ filter: 'shipped', q: 'a b', sort: 'name', page: 3 }),
    ).toBe('/dashboard/projects?stage=shipped&q=a+b&sort=name&page=3')
  })
})
