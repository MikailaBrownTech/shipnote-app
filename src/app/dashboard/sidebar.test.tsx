import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))

const { SidebarView } = await import('./sidebar')

const ID = '11111111-2222-4333-8444-555555555555'

function current(pathname: string) {
  const html = renderToStaticMarkup(<SidebarView pathname={pathname} />)
  return [
    ...html.matchAll(/aria-current="page"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)</g),
  ].map((match) => match[1])
}

describe('dashboard sidebar', () => {
  it('lists only pages that exist, plus sign out', () => {
    const html = renderToStaticMarkup(<SidebarView pathname="/dashboard" />)
    for (const label of [
      'Dashboard',
      'Projects',
      'Posts',
      'New project',
      'Account',
      'Sign out',
    ]) {
      expect(html).toContain(label)
    }
    for (const missing of ['Generate', 'Analytics', 'Upgrade']) {
      expect(html).not.toContain(missing)
    }
  })

  it('marks the dashboard current on the home page only', () => {
    expect(current('/dashboard')).toEqual(['Dashboard'])
  })

  it('marks Projects current on the list and on a project', () => {
    expect(current('/dashboard/projects')).toEqual(['Projects'])
    expect(current(`/dashboard/projects/${ID}`)).toEqual(['Projects'])
    expect(current(`/dashboard/projects/${ID}/edit`)).toEqual(['Projects'])
  })

  it('marks Voice on the voice settings page', () => {
    expect(current('/dashboard/settings/voice')).toEqual(['Voice'])
  })

  it('marks Calendar and GitHub on their own pages', () => {
    expect(current('/dashboard/calendar')).toEqual(['Calendar'])
    expect(current('/dashboard/github')).toEqual(['GitHub'])
  })

  it('lists the pages in the order of the mockups', () => {
    const html = renderToStaticMarkup(<SidebarView pathname="/dashboard" />)
    const order = [
      'Dashboard',
      'Projects',
      'New project',
      'Calendar',
      'Posts',
      'GitHub',
    ]
    const at = order.map((label) => html.indexOf(label + '<'))
    expect(at.every((n) => n > -1)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
  })

  it('marks Posts on the posts page', () => {
    expect(current('/dashboard/posts')).toEqual(['Posts'])
  })

  it('marks New project and Account on their own pages', () => {
    expect(current('/dashboard/projects/new')).toEqual(['New project'])
    expect(current('/dashboard/account')).toEqual(['Account'])
  })

  it('marks nothing while the path is unknown (the Suspense fallback)', () => {
    expect(current('')).toEqual([])
  })
})
