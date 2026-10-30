import { describe, expect, it } from 'vitest'
import { GET, POST } from './route'

describe('GET /api/health', () => {
  it('answers 200 with exactly {"ok":true}, uncached', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toBe('{"ok":true}')
  })
})

describe('POST /api/health', () => {
  it('answers 405', () => {
    const res = POST()
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET')
  })
})
