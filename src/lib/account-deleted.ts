// What the "account deleted" page may be told through its address, read
// strictly so nothing in the URL is ever echoed: buffer=1 (the person had a
// Buffer connection) and left=<1 to 999> (scheduled posts that could not be
// cancelled in Buffer). Anything else is ignored. No imports.
export type DeletedNotes = { buffer: boolean; left: number }

const first = (value: unknown) => (Array.isArray(value) ? undefined : value)

export function parseDeletedNotes(query: {
  buffer?: unknown
  left?: unknown
}): DeletedNotes {
  const left = first(query.left)
  return {
    buffer: first(query.buffer) === '1',
    left:
      typeof left === 'string' && /^[1-9]\d{0,2}$/.test(left)
        ? Number(left)
        : 0,
  }
}
