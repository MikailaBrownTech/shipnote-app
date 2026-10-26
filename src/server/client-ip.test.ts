import { beforeEach, describe, expect, it, vi } from 'vitest'

let headerValue: string | null = null

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'x-vercel-forwarded-for' ? headerValue : 'should-not-be-read',
    }),
}))

const { getClientIp, UNKNOWN_IP } = await import('./client-ip')

describe('getClientIp', () => {
  beforeEach(() => {
    headerValue = null
  })

  it('reads the Vercel header', async () => {
    headerValue = '203.0.113.7'
    expect(await getClientIp()).toBe('203.0.113.7')
  })

  it('takes the first entry of a list', async () => {
    headerValue = '203.0.113.7, 10.0.0.1'
    expect(await getClientIp()).toBe('203.0.113.7')
  })

  it('falls back to a shared bucket for missing or invalid values', async () => {
    expect(await getClientIp()).toBe(UNKNOWN_IP)
    headerValue = 'not an ip'
    expect(await getClientIp()).toBe(UNKNOWN_IP)
  })
})
