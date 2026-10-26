import { describe, expect, it, vi } from 'vitest'
import { allow, type Limiter } from './rate-limit-core'

// A fake sliding window: allows `max` calls per key, then blocks.
function fakeLimiter(max: number): Limiter {
  const seen = new Map<string, number>()
  return {
    limit: (key) => {
      const count = (seen.get(key) ?? 0) + 1
      seen.set(key, count)
      return Promise.resolve({ success: count <= max })
    },
  }
}

describe('allow', () => {
  it('blocks after the limit', async () => {
    const limiter = fakeLimiter(3)
    const results = []
    for (let i = 0; i < 5; i++) results.push(await allow(limiter, 'k'))
    expect(results).toEqual([true, true, true, false, false])
  })

  it('counts each key separately', async () => {
    const limiter = fakeLimiter(1)
    expect(await allow(limiter, 'a')).toBe(true)
    expect(await allow(limiter, 'b')).toBe(true)
    expect(await allow(limiter, 'a')).toBe(false)
  })

  it('fails open when the limiter is too slow', async () => {
    vi.useFakeTimers()
    const onFailOpen = vi.fn()
    const slow: Limiter = { limit: () => new Promise(() => undefined) }
    const pending = allow(slow, 'k', { timeoutMs: 100, onFailOpen })
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe(true)
    expect(onFailOpen).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('fails open when the limiter throws', async () => {
    const onFailOpen = vi.fn()
    const broken: Limiter = { limit: () => Promise.reject(new Error('down')) }
    expect(await allow(broken, 'k', { onFailOpen })).toBe(true)
    expect(onFailOpen).toHaveBeenCalledOnce()
  })

  it('allows everything when no limiter is configured', async () => {
    expect(await allow(null, 'k')).toBe(true)
  })
})
