import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(entry.name) &&
      entry.name !== 'no-raw-html.test.ts'
      ? [path]
      : []
  })
}

describe('project text is plain text', () => {
  it('no source file uses dangerouslySetInnerHTML or innerHTML', () => {
    const offenders = sources(import.meta.dirname).filter((file) =>
      /dangerouslySetInnerHTML|\.innerHTML\b/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
