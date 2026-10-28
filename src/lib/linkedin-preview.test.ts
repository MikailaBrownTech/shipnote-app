import { describe, expect, it } from 'vitest'
import {
  CLAMP_CHARS,
  CLAMP_LINES,
  isCut,
  profileName,
  splitHashtags,
} from './linkedin-preview'

describe('isCut', () => {
  it('a short post is not cut', () => {
    expect(isCut('Just shipped a thing.')).toBe(false)
    expect(isCut('')).toBe(false)
  })

  it('cuts after 210 characters, not at 210', () => {
    expect(isCut('x'.repeat(CLAMP_CHARS))).toBe(false)
    expect(isCut('x'.repeat(CLAMP_CHARS + 1))).toBe(true)
  })

  it('cuts after three lines, not at three', () => {
    const lines = (n: number) => Array.from({ length: n }, () => 'a').join('\n')
    expect(isCut(lines(CLAMP_LINES))).toBe(false)
    expect(isCut(lines(CLAMP_LINES + 1))).toBe(true)
  })

  it('counts characters, not UTF-16 units, so an emoji is one', () => {
    expect(isCut('😀'.repeat(CLAMP_CHARS))).toBe(false)
    expect(isCut('😀'.repeat(CLAMP_CHARS + 1))).toBe(true)
  })

  it('ignores spaces at the ends and reads Windows line breaks as one break', () => {
    expect(isCut(`  ${'x'.repeat(CLAMP_CHARS)}  `)).toBe(false)
    expect(isCut('a\r\nb\r\nc')).toBe(false)
    expect(isCut('a\r\nb\r\nc\r\nd')).toBe(true)
  })
})

describe('splitHashtags', () => {
  const join = (pieces: { text: string }[]) =>
    pieces.map((piece) => piece.text).join('')

  it('finds hashtags and leaves the rest as it is', () => {
    expect(splitHashtags('Shipped it #buildinpublic and #SaaS today')).toEqual([
      { text: 'Shipped it ', hashtag: false },
      { text: '#buildinpublic', hashtag: true },
      { text: ' and ', hashtag: false },
      { text: '#SaaS', hashtag: true },
      { text: ' today', hashtag: false },
    ])
  })

  it('putting the pieces back together gives the text exactly', () => {
    for (const text of [
      '#start of the post',
      'end with a tag #end',
      '#a#b #c',
      'No tags at all.',
      'Line one\n\n#tag line two\n',
      '',
    ]) {
      expect(join(splitHashtags(text))).toBe(text)
    }
  })

  it('a post that starts with a hashtag still marks it', () => {
    expect(splitHashtags('#first then text')[0]).toEqual({
      text: '#first',
      hashtag: true,
    })
  })

  it('knows letters and numbers in other scripts, and underscores', () => {
    const tags = splitHashtags('#café #日本語 #v2 #snake_case')
      .filter((p) => p.hashtag)
      .map((p) => p.text)
    expect(tags).toEqual(['#café', '#日本語', '#v2', '#snake_case'])
  })

  it('does not call a lone # or C# a hashtag', () => {
    expect(splitHashtags('Issue # 5 and C# code').some((p) => p.hashtag)).toBe(
      false,
    )
  })

  it('never turns anything into a link or markup, only plain text pieces', () => {
    const pieces = splitHashtags(
      '<script>alert(1)</script> #tag https://x.example',
    )
    expect(Object.keys(pieces[0] ?? {}).sort()).toEqual(['hashtag', 'text'])
    expect(join(pieces)).toBe(
      '<script>alert(1)</script> #tag https://x.example',
    )
  })
})

describe('profileName', () => {
  it('uses the name and its first letter', () => {
    expect(profileName('  my linkedin ')).toEqual({
      label: 'my linkedin',
      initial: 'M',
    })
    expect(profileName('Émile')).toEqual({ label: 'Émile', initial: 'É' })
  })

  it('a missing or blank name is a plain stand-in with no letter', () => {
    for (const name of [null, undefined, '', '   ']) {
      expect(profileName(name)).toEqual({
        label: 'Your LinkedIn profile',
        initial: null,
      })
    }
  })
})
