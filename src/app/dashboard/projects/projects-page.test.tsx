import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Projects page, rendered on the server: what is on it in each state.

const requireUser = vi.fn()
const listProjects = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/projects', () => ({ listProjects }))

const { default: ProjectsPage } = await import('./page')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const uid = (n: number) =>
  `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`

const project = (n: number, over: Record<string, unknown> = {}) => ({
  id: uid(n),
  name: `Project ${String(n)}`,
  summary: `Summary of project ${String(n)}`,
  stage: 'in_progress',
  notes: '',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: `2026-10-${String(10 + n)}T10:00:00Z`,
  repoFullName: null,
  installationId: null,
  ...over,
})

async function render(search: Record<string, string> = {}) {
  const element: ReactElement = (
    <ProjectsPage
      params={Promise.resolve({})}
      searchParams={Promise.resolve(search)}
    />
  )
  const errors: unknown[] = []
  const stream = await renderToReadableStream(element, {
    onError: (error) => {
      errors.push(error)
    },
  })
  await stream.allReady
  const html = (await new Response(stream).text()).replaceAll('<!-- -->', '')
  return { html, errors }
}

const names = (html: string) =>
  [...html.matchAll(/<h3><a[^>]*>([^<]+)<\/a><\/h3>/g)].map((m) => m[1])

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  listProjects.mockResolvedValue({
    ok: true,
    value: [
      project(1, { stage: 'idea' }),
      project(2, { repoFullName: 'octo/two' }),
      project(3, { stage: 'shipped', name: 'Alpha Shipped' }),
    ],
  })
})

describe('the Projects page', () => {
  it('needs a signed-in user and reads only their own projects', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
    expect(listProjects).toHaveBeenCalledExactlyOnceWith(USER)
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    listProjects.mockClear()
    const denied = await render()
    expect(String(denied.errors[0])).toContain('redirect:/sign-in')
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('shows the title, a New project button and every project, newest first', async () => {
    const { html } = await render()
    expect(html).toMatch(/<h1>(<span[^>]*>)?Projects/)
    expect(html).toContain('Everything you are building, in one place.')
    expect(html).toContain('href="/dashboard/projects/new"')
    expect(names(html)).toEqual(['Alpha Shipped', 'Project 2', 'Project 1'])
    expect(html).toContain(`href="/dashboard/projects/${uid(2)}"`)
    expect(html).toContain('Summary of project 2')
    expect(html).toContain('3 of 5 projects used.')
  })

  it('says which repository a project is linked to, or that none is', async () => {
    const { html } = await render()
    expect(html).toContain('octo/two')
    expect(html.match(/No repository linked/g)).toHaveLength(2)
  })

  it('has a tab for each stage, with counts', async () => {
    const { html } = await render()
    for (const tab of ['All projects', 'Ideas', 'In progress', 'Shipped']) {
      expect(html).toContain(tab)
    }
    expect(html).toMatch(/All projects<span[^>]*>3<\/span>/)
    expect(html).toMatch(/Ideas<span[^>]*>1<\/span>/)
    expect(html).toMatch(/In progress<span[^>]*>1<\/span>/)
    expect(html).toContain('href="/dashboard/projects?stage=shipped"')
    expect(html).toMatch(/aria-current="page"[^>]*>All projects/)
  })

  it('filters by stage', async () => {
    const { html } = await render({ stage: 'shipped' })
    expect(names(html)).toEqual(['Alpha Shipped'])
    expect(html).toMatch(/aria-current="page"[^>]*>Shipped/)
  })

  it('searches, and says so when nothing matches', async () => {
    expect(names((await render({ q: 'alpha' })).html)).toEqual([
      'Alpha Shipped',
    ])
    const none = await render({ q: 'zzz' })
    expect(none.html).toContain('No projects match your search.')
    expect(none.html).toContain('href="/dashboard/projects"')
  })

  it('sorts by name and by stage', async () => {
    expect(names((await render({ sort: 'name' })).html)).toEqual([
      'Alpha Shipped',
      'Project 1',
      'Project 2',
    ])
    expect(names((await render({ sort: 'stage' })).html)).toEqual([
      'Project 1',
      'Project 2',
      'Alpha Shipped',
    ])
  })

  it('an odd stage, sort or page falls back to the defaults, and nothing is echoed', async () => {
    const { html } = await render({
      stage: 'done',
      sort: 'drop table',
      page: '-3',
      q: '"><script>alert(1)</script>',
    })
    expect(html).not.toContain('alert(1)</script>')
    expect(html).not.toContain('<script>alert')
    expect(html).toMatch(/aria-current="page"[^>]*>All projects/)
  })

  it('pages a long list, eight at a time, with links', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: Array.from({ length: 11 }, (_, i) => project(i + 1)),
    })
    const first = await render({ sort: 'name' })
    expect(names(first.html)).toHaveLength(8)
    expect(first.html).toContain('Page 1 of 2')
    expect(first.html).toContain('11 projects')
    expect(first.html).toContain(
      'href="/dashboard/projects?sort=name&amp;page=2"',
    )
    const second = await render({ sort: 'name', page: '2' })
    expect(names(second.html)).toHaveLength(3)
    expect(second.html).toContain('Page 2 of 2')
    const past = await render({ page: '99' })
    expect(past.html).toContain('Page 2 of 2')
  })

  it('has no pager for a short list', async () => {
    expect((await render()).html).not.toContain('projects pages')
  })

  it('at the limit, says so and hides New project', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: Array.from({ length: 5 }, (_, i) => project(i + 1)),
    })
    const { html } = await render()
    expect(html).toContain('You have reached the 5 project limit.')
    expect(html).not.toContain('href="/dashboard/projects/new"')
  })

  it('has a friendly empty state with no projects', async () => {
    listProjects.mockResolvedValue({ ok: true, value: [] })
    const { html } = await render()
    expect(html).toContain('No projects yet')
    expect(html).toContain('href="/dashboard/projects/new"')
    expect(html).not.toContain('role="search"')
  })

  it('a plain message if the projects cannot be read', async () => {
    listProjects.mockResolvedValue({ ok: false })
    const { html } = await render()
    expect(html).toContain('We could not load your projects.')
  })

  it('shows project text as text, never as markup', async () => {
    listProjects.mockResolvedValue({
      ok: true,
      value: [
        project(1, {
          name: '<img src=x onerror=alert(1)>',
          summary: '<script>alert(1)</script>',
          repoFullName: 'octo/<b>x</b>',
        }),
      ],
    })
    const { html } = await render()
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<b>x</b>')
  })
})
