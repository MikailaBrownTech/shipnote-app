import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinkedinPreview } from './linkedin-preview'

const render = (props: Parameters<typeof LinkedinPreview>[0]) =>
  renderToStaticMarkup(<LinkedinPreview {...props} />).replaceAll(
    '<!-- -->',
    '',
  )

const SHORT =
  'Just shipped a new feature.\n\nBuilt with Next.js. #BuildInPublic #NextJS'
const LONG = `${'A long post that goes on and on. '.repeat(10)}#tag`

describe('LinkedinPreview', () => {
  it('shows the post as a LinkedIn card, with the name, a headline and when', () => {
    const html = render({
      body: SHORT,
      name: 'My LinkedIn',
      headline: 'Software Developer',
      when: '10:00 AM UTC',
    })
    expect(html).toContain('aria-label="LinkedIn post preview"')
    expect(html).toContain('<strong>My LinkedIn</strong>')
    expect(html).toContain('Software Developer')
    expect(html).toContain('10:00 AM UTC')
    expect(html).toContain('Visible to anyone')
    expect(html).toContain('Just shipped a new feature.')
    // The avatar is the first letter of the name.
    expect(html).toMatch(/_avatar_[^>]*aria-hidden="true">M</)
  })

  it('without a name it says plainly that it is a stand-in, and invents nothing', () => {
    const html = render({ body: SHORT })
    expect(html).toContain('<strong>Your LinkedIn profile</strong>')
    expect(html).toContain('>Preview<')
    expect(html).toContain('Now')
    expect(html).not.toMatch(/_avatar_[^>]*>[A-Z]</)
  })

  it('colours hashtags, and only hashtags', () => {
    const html = render({ body: SHORT })
    const tags = [
      ...html.matchAll(/<span class="[^"]*_hashtag_[^"]*">([^<]*)</g),
    ].map((m) => m[1])
    expect(tags).toEqual(['#BuildInPublic', '#NextJS'])
  })

  it('keeps line breaks and shows a short post whole, with no “more”', () => {
    const html = render({ body: SHORT })
    expect(html).toContain('feature.\n\nBuilt with')
    expect(html).not.toContain('…more')
    expect(html).not.toMatch(/_clamp_/)
  })

  it('cuts a long post and offers “…more”, closed to start with', () => {
    const html = render({ body: LONG })
    expect(html).toMatch(/_clamp_/)
    expect(html).toContain('…more')
    expect(html).toContain('aria-expanded="false"')
    // The whole text is still in the page, only clipped by style.
    expect(html).toContain('#tag')
    expect(html).toContain('goes on and on.')
  })

  it('draws the four actions, hidden from screen readers and doing nothing', () => {
    const html = render({ body: SHORT })
    const bar = html.split('_actions_')[1] ?? ''
    expect(bar).toContain('aria-hidden="true"')
    for (const label of ['Like', 'Comment', 'Repost', 'Send']) {
      expect(bar).toContain(label)
    }
    expect(html).not.toContain('<a ')
    expect(html.match(/<button/g)).toBeNull()
  })

  it('says it is a close picture, not LinkedIn', () => {
    expect(render({ body: SHORT })).toContain(
      'A close picture of how this may look on LinkedIn.',
    )
  })

  it('shows an empty post as a plain prompt, with no actions bar of text', () => {
    for (const body of ['', '   \n  ']) {
      const html = render({ body })
      expect(html).toContain('Nothing to preview yet.')
      expect(html).not.toMatch(/_text_/)
    }
  })

  it('shows markup, links and scripts in the text as text', () => {
    const html = render({
      body: '<img src=x onerror=alert(1)> <script>alert(1)</script> https://evil.example [a](https://b.example)',
      name: '<b>Name</b>',
      headline: '<i>Headline</i>',
    })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>Name')
    expect(html).not.toContain('<i>Headline')
    expect(html).not.toContain('<a ')
    expect(html).toContain('&lt;script&gt;')
  })

  it('reads Windows line breaks as line breaks', () => {
    const html = render({ body: 'one\r\ntwo' })
    expect(html).toContain('one\ntwo')
    expect(html).not.toContain('\r')
  })
})
