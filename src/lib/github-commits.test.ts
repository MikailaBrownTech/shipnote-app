import { describe, expect, it } from 'vitest'
import { commitUrl, isRepoFullName, repoUrl, splitRepo } from './github-repo'
import {
  commitTitle,
  MAX_COMMITS,
  MAX_TITLE_CHARS,
  selectPostCommits,
  sinceDate,
} from './github-commits'

// Distinct in the first 7 characters, which is what the page shows.
const sha = (n: number) => n.toString(16).padStart(7, '0') + 'a'.repeat(33)
const commit = (
  message: string,
  n = 1,
  date: string | null = '2026-10-20T10:00:00Z',
) => ({
  sha: sha(n),
  message,
  date,
})

describe('selectPostCommits', () => {
  it('keeps only commits whose message contains [post], in any case', () => {
    const picked = selectPostCommits(
      [
        commit('Fix bug', 1),
        commit('Ship it [post]', 2),
        commit('Big launch [POST]', 3),
        commit('Mixed [PoSt] case', 4),
        commit('Not a tag: post', 5),
        commit('(post) wrong brackets', 6),
        commit('[ post ] spaced', 7),
      ],
      'octo/hello',
    )
    expect(picked.map((c) => c.title)).toEqual([
      'Ship it [post]',
      'Big launch [POST]',
      'Mixed [PoSt] case',
    ])
  })

  it('finds the tag anywhere in the message, not just the first line', () => {
    const picked = selectPostCommits(
      [commit('Add export\n\nMore detail here [post]')],
      'octo/hello',
    )
    expect(picked).toHaveLength(1)
    expect(picked[0].title).toBe('Add export')
  })

  it('returns a short sha, the date and a link built from the repo name and sha', () => {
    const [first] = selectPostCommits([commit('x [post]', 255)], 'octo/hello')
    expect(first).toEqual({
      sha: '00000ff',
      title: 'x [post]',
      date: '2026-10-20T10:00:00Z',
      url: `https://github.com/octo/hello/commit/${sha(255)}`,
    })
  })

  it('returns at most 20', () => {
    const many = Array.from({ length: 60 }, (_, i) => commit('[post] a', i + 1))
    expect(selectPostCommits(many, 'octo/hello')).toHaveLength(MAX_COMMITS)
    expect(MAX_COMMITS).toBe(20)
  })

  it('returns nothing, not an error, for no matches or no commits', () => {
    expect(selectPostCommits([], 'octo/hello')).toEqual([])
    expect(selectPostCommits([commit('plain')], 'octo/hello')).toEqual([])
  })

  it('drops an entry whose sha is not hexadecimal, so a link cannot be bent', () => {
    const picked = selectPostCommits(
      [
        { sha: '../../evil', message: '[post] x', date: null },
        { sha: 'abc"><script>', message: '[post] x', date: null },
        { sha: 'abc', message: '[post] too short', date: null },
      ],
      'octo/hello',
    )
    expect(picked).toEqual([])
  })

  it('never returns more than a sha, title, date and link', () => {
    const [first] = selectPostCommits(
      [
        {
          ...commit('Title [post]\n\nsecret body that must not travel'),
          files: ['secret.env'],
          patch: '+KEY=1',
        } as ReturnType<typeof commit>,
      ],
      'octo/hello',
    )
    expect(Object.keys(first).sort()).toEqual(['date', 'sha', 'title', 'url'])
    expect(JSON.stringify(first)).not.toMatch(/secret/)
  })

  it('keeps a markup-looking title as plain text for the page to escape', () => {
    const [first] = selectPostCommits(
      [commit('<img src=x onerror=alert(1)> [post]')],
      'octo/hello',
    )
    expect(first.title).toBe('<img src=x onerror=alert(1)> [post]')
  })
})

describe('commitTitle', () => {
  it('takes the first line and trims it', () => {
    expect(commitTitle('  Hello  \nsecond line')).toBe('Hello')
    expect(commitTitle('Hello\r\nsecond')).toBe('Hello')
  })

  it('caps the length, counting characters', () => {
    const long = 'x'.repeat(500)
    const title = commitTitle(long)
    expect(Array.from(title)).toHaveLength(MAX_TITLE_CHARS)
    expect(title.endsWith('…')).toBe(true)
    const emoji = commitTitle('\u{1F680}'.repeat(500))
    expect(Array.from(emoji)).toHaveLength(MAX_TITLE_CHARS)
    expect(emoji).not.toContain('�')
  })

  it('has a placeholder for an empty message', () => {
    expect(commitTitle('')).toBe('(no message)')
    expect(commitTitle('\n\nbody only')).toBe('(no message)')
  })

  it('drops control characters', () => {
    expect(commitTitle('a\u0000b\u001b[31mc')).toBe('ab[31mc')
  })
})

describe('sinceDate', () => {
  it('is 30 days before, as a second-precision UTC timestamp', () => {
    expect(sinceDate(Date.parse('2026-10-27T12:00:00.123Z'))).toBe(
      '2026-09-27T12:00:00Z',
    )
  })
})

describe('repository names', () => {
  it.each(['octo/hello', 'a/b', 'My-Org1/some.repo_name', 'octo/.github'])(
    'accepts %s',
    (name) => {
      expect(isRepoFullName(name)).toBe(true)
    },
  )

  it.each([
    'noslash',
    'a/b/c',
    '/repo',
    'owner/',
    '-owner/repo',
    'owner/..',
    'owner/.',
    'owner/re po',
    "owner/x'; drop table x;--",
    `${'o'.repeat(40)}/repo`,
    `owner/${'r'.repeat(101)}`,
    '',
    '../..',
  ])('refuses %s', (name) => {
    expect(isRepoFullName(name)).toBe(false)
  })

  it('refuses non-strings', () => {
    for (const value of [null, undefined, 1, {}, ['a/b']]) {
      expect(isRepoFullName(value)).toBe(false)
    }
  })

  it('builds the repository page URL from validated parts', () => {
    expect(repoUrl('octo/hello')).toBe('https://github.com/octo/hello')
    expect(repoUrl('octo/.github')).toBe('https://github.com/octo/.github')
  })

  it('splits and builds a commit URL from validated parts', () => {
    expect(splitRepo('octo/hello')).toEqual({ owner: 'octo', repo: 'hello' })
    expect(commitUrl('octo/hello', 'abc1234')).toBe(
      'https://github.com/octo/hello/commit/abc1234',
    )
  })
})

describe('hasPostTag', () => {
  it('sees [post] in any case, anywhere in the message', async () => {
    const { hasPostTag } = await import('./github-commits')
    expect(hasPostTag('Add export [post]')).toBe(true)
    expect(hasPostTag('[POST] first line')).toBe(true)
    expect(hasPostTag('title\n\nbody with [Post] inside')).toBe(true)
  })

  it('does not see anything else', async () => {
    const { hasPostTag } = await import('./github-commits')
    for (const message of [
      'post',
      '[posts]',
      '(post)',
      '[ post ]',
      'ghost',
      '',
    ]) {
      expect(hasPostTag(message)).toBe(false)
    }
  })
})
