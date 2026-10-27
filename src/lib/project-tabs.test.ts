import { describe, expect, it } from 'vitest'
import { chooseTab, PROJECT_TABS } from './project-tabs'

const on = { githubOn: true, hasGithubMessage: false }
const off = { githubOn: false, hasGithubMessage: false }

describe('chooseTab', () => {
  it('has the three tabs', () => {
    expect(PROJECT_TABS).toEqual(['overview', 'github', 'notes'])
  })

  it('defaults to overview', () => {
    expect(chooseTab({ value: undefined, ...on })).toBe('overview')
    expect(chooseTab({ value: undefined, ...off })).toBe('overview')
  })

  it('opens the tab that was asked for', () => {
    expect(chooseTab({ value: 'overview', ...on })).toBe('overview')
    expect(chooseTab({ value: 'github', ...on })).toBe('github')
    expect(chooseTab({ value: 'notes', ...on })).toBe('notes')
    expect(chooseTab({ value: 'notes', ...off })).toBe('notes')
  })

  it('has no GitHub tab while the feature is off', () => {
    expect(chooseTab({ value: 'github', ...off })).toBe('overview')
    expect(
      chooseTab({ value: 'github', githubOn: false, hasGithubMessage: true }),
    ).toBe('overview')
  })

  it('opens on GitHub when a GitHub message arrives with no tab', () => {
    expect(
      chooseTab({ value: undefined, githubOn: true, hasGithubMessage: true }),
    ).toBe('github')
  })

  it('an explicit tab wins over the message', () => {
    expect(
      chooseTab({ value: 'notes', githubOn: true, hasGithubMessage: true }),
    ).toBe('notes')
  })

  it('a message does nothing while the feature is off', () => {
    expect(
      chooseTab({ value: undefined, githubOn: false, hasGithubMessage: true }),
    ).toBe('overview')
  })

  it.each([
    '',
    'GITHUB',
    ' github',
    'settings',
    'posts',
    '<script>',
    '../../x',
    '__proto__',
    'constructor',
    ['github'],
    null,
    42,
    {},
  ])('ignores an invalid value (%j)', (value) => {
    expect(chooseTab({ value, ...on })).toBe('overview')
  })
})
