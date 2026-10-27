import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PageIntro } from './page-intro'
import { AccountRail, DetailRail, FormRail } from './rail'

describe('PageIntro', () => {
  it('puts the last word of the title in the accent colour', () => {
    const html = renderToStaticMarkup(<PageIntro title="New project" />)
    expect(html).toMatch(/New <span class="[^"]*accent[^"]*">project<\/span>/)
  })

  it('leaves a title plain when it is the user’s own text', () => {
    const html = renderToStaticMarkup(
      <PageIntro title="Acme web app" accent={false} />,
    )
    expect(html).toContain('<h1>Acme web app</h1>')
    expect(html).not.toContain('accent')
  })

  it('escapes a title that looks like markup', () => {
    const html = renderToStaticMarkup(
      <PageIntro title="<img src=x onerror=alert(1)>" accent={false} />,
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('shows a back link only when given a destination', () => {
    const without = renderToStaticMarkup(<PageIntro title="Account" />)
    expect(without).not.toContain('Back to dashboard')
    const withLink = renderToStaticMarkup(
      <PageIntro title="Account" backHref="/dashboard" />,
    )
    expect(withLink).toContain('href="/dashboard"')
    expect(withLink).toContain('Back to dashboard')
  })
})

describe('right-hand rails', () => {
  it('never promise scheduling or posting for the user', () => {
    const html = [FormRail, DetailRail, AccountRail]
      .map((Rail) => renderToStaticMarkup(<Rail />))
      .join(' ')
    expect(html).not.toMatch(/schedul/i)
    expect(html).toMatch(/never posts for you|post them yourself/)
  })
})
