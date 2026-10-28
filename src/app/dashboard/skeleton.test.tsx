import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PageSkeleton, SkeletonRows } from './skeleton'

const count = (html: string, pattern: RegExp) =>
  html.match(pattern)?.length ?? 0

describe('PageSkeleton', () => {
  it('announces loading once, and hides the shapes from screen readers', () => {
    const html = renderToStaticMarkup(<PageSkeleton rows={3} side />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('aria-live="polite"')
    expect(count(html, />Loading</g)).toBe(1)
    // Every grey shape is decoration, hidden from screen readers.
    const shapes = html.match(/<span class="[^"]*_block_[^"]*"[^>]*>/g) ?? []
    expect(shapes.length).toBeGreaterThan(5)
    for (const shape of shapes) expect(shape).toContain('aria-hidden="true"')
    expect(count(html, /aria-hidden="true"/g)).toBeGreaterThan(5)
  })

  it('draws only the parts it is asked for', () => {
    const bare = renderToStaticMarkup(<PageSkeleton />)
    const full = renderToStaticMarkup(
      <PageSkeleton back tabs tiles={4} rows={5} form={3} side />,
    )
    expect(full.length).toBeGreaterThan(bare.length)
    expect(count(full, /class="[^"]*_tile_/g)).toBe(4)
    expect(count(full, /class="[^"]*_tab_/g)).toBe(4)
    expect(count(full, /class="[^"]*_back_/g)).toBe(1)
    expect(count(full, /class="[^"]*_field_/g)).toBe(3)
    expect(count(full, /class="[^"]*_sideCard_/g)).toBe(1)
    expect(count(bare, /class="[^"]*_tile_/g)).toBe(0)
    expect(count(bare, /class="[^"]*_sideCard_/g)).toBe(0)
  })

  it('has no text but the announcement, so nothing from the real page shows', () => {
    const html = renderToStaticMarkup(
      <PageSkeleton back tabs tiles={4} rows={5} form={3} side />,
    )
    const text = html.replace(/<[^>]*>/g, '').trim()
    expect(text).toBe('Loading')
  })
})

describe('SkeletonRows', () => {
  it('shows the number of rows asked for, with one announcement', () => {
    const html = renderToStaticMarkup(<SkeletonRows rows={4} />)
    expect(count(html, /class="[^"]*_icon_/g)).toBe(4)
    expect(count(html, />Loading</g)).toBe(1)
    expect(html).toContain('role="status"')
  })
})

describe('no page still says it is loading in words', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })

  it('every Suspense fallback in the dashboard is a skeleton', () => {
    const root = join(import.meta.dirname)
    const offenders = walk(root)
      .filter((file) => /\.tsx$/.test(file) && !/\.test\./.test(file))
      .filter((file) =>
        /fallback=\{\s*<p[^>]*>\s*Loading/i.test(readFileSync(file, 'utf8')),
      )
    expect(offenders).toEqual([])
  })

  it('the pages that load use the skeleton', () => {
    const root = join(import.meta.dirname)
    const used = walk(root)
      .filter((file) => /page\.tsx$/.test(file))
      .filter((file) =>
        /fallback=\{<(?:PageSkeleton|SkeletonRows)/.test(
          readFileSync(file, 'utf8'),
        ),
      )
    expect(used.length).toBe(10)
  })
})
