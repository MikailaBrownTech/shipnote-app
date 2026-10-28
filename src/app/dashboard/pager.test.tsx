import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Pager, usePaged } from './pager'
import { PagerLinks } from './pager-links'

const html = (node: React.ReactElement) =>
  renderToStaticMarkup(node).replaceAll('<!-- -->', '')

describe('Pager', () => {
  it('shows nothing for one page or none', () => {
    for (const pages of [0, 1]) {
      expect(
        html(
          <Pager
            page={1}
            pages={pages}
            total={3}
            noun="drafts"
            onPage={() => undefined}
          />,
        ),
      ).toBe('')
    }
  })

  it('says how many there are and where you are, with a labelled nav', () => {
    const out = html(
      <Pager
        page={2}
        pages={4}
        total={18}
        noun="drafts"
        onPage={() => undefined}
      />,
    )
    expect(out).toContain('aria-label="drafts pages"')
    expect(out).toContain('18 drafts')
    expect(out).toContain('Page 2 of 4')
    expect(out).toContain('aria-current="page"')
    expect(out).toContain('>Previous<')
    expect(out).toContain('>Next<')
  })

  it('turns Previous off on the first page and Next off on the last', () => {
    const first = html(
      <Pager page={1} pages={3} total={11} noun="x" onPage={() => undefined} />,
    )
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*>Previous</)
    expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*>Next</)
    const last = html(
      <Pager page={3} pages={3} total={11} noun="x" onPage={() => undefined} />,
    )
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Next</)
    expect(last).not.toMatch(/<button[^>]*disabled=""[^>]*>Previous</)
  })

  it('its buttons are plain buttons, so they never submit a form around them', () => {
    const out = html(
      <Pager page={2} pages={3} total={11} noun="x" onPage={() => undefined} />,
    )
    for (const tag of out.match(/<button[^>]*>/g) ?? []) {
      expect(tag).toContain('type="button"')
    }
  })
})

describe('usePaged', () => {
  function Probe({ total, size }: { total: number; size: number }) {
    const paged = usePaged(total, size)
    const items = Array.from({ length: total }, (_, i) => i + 1)
    return (
      <p>
        {paged.page}/{paged.pages}|
        {items.filter((_, i) => paged.visible(i)).join(',')}|
        {paged.slice(items).join(',')}
      </p>
    )
  }
  const probe = (total: number, size = 5) =>
    html(<Probe total={total} size={size} />).replace(/<\/?p>/g, '')

  it('starts on the first page, showing the first items', () => {
    expect(probe(12)).toBe('1/3|1,2,3,4,5|1,2,3,4,5')
  })

  it('a short list is one page, and an empty one is one empty page', () => {
    expect(probe(3)).toBe('1/1|1,2,3|1,2,3')
    expect(probe(0)).toBe('1/1||')
  })

  it('a list that is exactly a page is one page', () => {
    expect(probe(5)).toBe('1/1|1,2,3,4,5|1,2,3,4,5')
    expect(probe(6)).toBe('1/2|1,2,3,4,5|1,2,3,4,5')
  })
})

describe('PagerLinks', () => {
  const hrefFor = (page: number) => `/list?p=${String(page)}`

  it('shows nothing for one page', () => {
    expect(
      html(
        <PagerLinks
          page={1}
          pages={1}
          total={3}
          noun="commits"
          hrefFor={hrefFor}
        />,
      ),
    ).toBe('')
  })

  it('links to the other pages, and says where you are', () => {
    const out = html(
      <PagerLinks
        page={2}
        pages={3}
        total={12}
        noun="commits"
        hrefFor={hrefFor}
      />,
    )
    expect(out).toContain('href="/list?p=1"')
    expect(out).toContain('href="/list?p=3"')
    expect(out).toContain('Page 2 of 3')
    expect(out).toContain('12 commits')
  })

  it('the ends are not links', () => {
    const first = html(
      <PagerLinks page={1} pages={3} total={12} noun="x" hrefFor={hrefFor} />,
    )
    expect(first).not.toContain('href="/list?p=0"')
    expect(first).toMatch(/aria-disabled="true"[^>]*>Previous</)
    const last = html(
      <PagerLinks page={3} pages={3} total={12} noun="x" hrefFor={hrefFor} />,
    )
    expect(last).not.toContain('href="/list?p=4"')
    expect(last).toMatch(/aria-disabled="true"[^>]*>Next</)
  })
})
