import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The commit list only appears after "Check for [post] commits" has run, and
// the server render cannot press a button. So the hook that holds the result of
// that check is told what the check found; the component is the real one.
const found = vi.hoisted((): { state: unknown; check: () => undefined } => ({
  state: { status: 'idle' },
  // What the component gets from `checkCommitsAction.bind(...)`.
  check: () => undefined,
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useActionState: (action: unknown, initial: unknown) => [
      action === found.check ? found.state : initial,
      action,
      false,
    ],
  }
})
vi.mock('server-only', () => ({}))
vi.mock('./draft-actions', () => ({
  copyDraftAction: vi.fn(),
  discardDraftAction: vi.fn(),
  generateDraftAction: vi.fn(),
  saveDraftAction: vi.fn(),
}))
vi.mock('./github-actions', () => ({
  checkCommitsAction: { bind: () => found.check },
}))
vi.mock('./auto-draft-actions', () => ({ setAutoDraftAction: vi.fn() }))
vi.mock('../buffer/actions', () => ({
  startReviewAction: vi.fn(),
  confirmScheduleAction: vi.fn(),
  cancelScheduleAction: vi.fn(),
  connectBufferAction: vi.fn(),
  disconnectBufferAction: vi.fn(),
}))

const { DraftWorkshop } = await import('./draft-controls')

const sha = (n: number) => `a${String(n)}b2c3d`
const full = (n: number) => `${sha(n)}${'0'.repeat(33)}`
const commit = (n: number) => ({
  sha: sha(n),
  title: `[post] commit ${String(n)}`,
  date: '2026-10-01T10:00:00Z',
  url: `https://github.com/octo/hello/commit/${full(n)}`,
})

async function render(commits: number[], covered: number[]) {
  found.state = { status: 'ok', commits: commits.map(commit) }
  const element = (
    <DraftWorkshop
      projectId="11111111-2222-4333-8444-555555555555"
      canUseCommits
      initialLeft={10}
      covered={covered.map(full)}
      recent={[]}
      scheduling={null}
      auto={null}
      savedTone={null}
    />
  ) as ReactElement
  const stream = await renderToReadableStream(element)
  await stream.allReady
  const html = (await new Response(stream).text()).replaceAll('<!-- -->', '')
  // One entry per commit checkbox, in page order.
  const boxes = [...html.matchAll(/<input[^>]*name="sha"[^>]*>/g)].map(
    (match) => ({
      value: /value="([^"]*)"/.exec(match[0])?.[1],
      checked: / checked(=|\s|>|\/)/.test(match[0]),
      disabled: / disabled(=|\s|>|\/)/.test(match[0]),
    }),
  )
  return { html, boxes }
}

describe('commits already used in a copied draft', () => {
  it('are unticked by default, and the rest are ticked', async () => {
    const { boxes } = await render([1, 2, 3], [2])
    expect(boxes).toEqual([
      { value: sha(1), checked: true, disabled: false },
      { value: sha(2), checked: false, disabled: false },
      { value: sha(3), checked: true, disabled: false },
    ])
  })

  it('say so, and the count of ticked commits leaves them out', async () => {
    const { html } = await render([1, 2, 3], [2])
    expect(html.match(/Used in a draft/g)).toHaveLength(1)
    expect(html).toContain('Ticked: 2.')
  })

  it('leave nothing ticked when every commit is covered', async () => {
    const { boxes, html } = await render([1, 2], [1, 2])
    expect(boxes.map((box) => box.checked)).toEqual([false, false])
    expect(html).toContain('Ticked: 0.')
  })

  it('can still be ticked, which takes one explicit click', async () => {
    // Enabled, so a click is possible; not ticked, so without one it is not sent.
    const { boxes } = await render([1, 2], [1])
    expect(boxes[0]).toEqual({ value: sha(1), checked: false, disabled: false })
  })

  it('are matched by the full sha, so a different commit is not mistaken for one', async () => {
    const { boxes } = await render([1, 2], [3])
    expect(boxes.map((box) => box.checked)).toEqual([true, true])
  })

  it('stay unticked when five others already fill the limit, and cannot be ticked until one is removed', async () => {
    const { boxes } = await render([1, 2, 3, 4, 5, 6], [6])
    expect(boxes.slice(0, 5).every((box) => box.checked)).toBe(true)
    expect(boxes[5]).toEqual({ value: sha(6), checked: false, disabled: true })
  })
})
