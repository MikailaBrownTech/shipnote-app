import { describe, expect, it, vi } from 'vitest'

// The proxy's entry point and its matcher: what it runs on, and what it must
// leave alone. What it does to a request is tested in
// src/lib/supabase/tampered-cookie.test.ts, with real tokens.

const updateSession = vi.fn()

vi.mock('@/lib/supabase/proxy', () => ({ updateSession }))

const { config, proxy } = await import('./proxy')

// Next's matcher is a path pattern. This one is a single negative-lookahead
// group, which a plain regular expression reads the same way.
const matcher = config.matcher[0]
const runsOn = (path: string) => new RegExp(`^${matcher}$`).test(path)

describe('proxy', () => {
  it('hands every request to updateSession and returns its answer', async () => {
    const answer = new Response(null, { status: 204 })
    updateSession.mockResolvedValue(answer)
    const request = { nextUrl: { pathname: '/dashboard' } } as never
    expect(await proxy(request)).toBe(answer)
    expect(updateSession).toHaveBeenCalledExactlyOnceWith(request)
  })
})

describe('the matcher', () => {
  it('has exactly one pattern', () => {
    expect(config.matcher).toHaveLength(1)
  })

  it.each([
    '/',
    '/sign-in',
    '/auth/callback',
    '/dashboard',
    '/dashboard/projects',
    '/dashboard/projects/11111111-2222-4333-8444-555555555555/edit',
    '/dashboard/github/callback',
    '/dashboard/buffer/callback',
    '/account-deleted',
    '/api/other',
  ])(
    'runs on %s, so a session is refreshed and /dashboard is guarded',
    (path) => {
      expect(runsOn(path)).toBe(true)
    },
  )

  it.each([
    '/api/webhooks/github',
    '/api/webhooks',
    '/api/queue/draft',
    '/api/queue',
    '/api/health',
  ])(
    'skips %s, which authenticates itself and must not touch cookies',
    (path) => {
      expect(runsOn(path)).toBe(false)
    },
  )

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/logo-mark.png',
    '/icon.png',
    '/apple-icon.png',
    '/favicon.ico',
    '/robots.txt',
    '/fonts/inter.woff2',
    '/assets/app.css',
    '/file.svg',
  ])('skips the static file %s', (path) => {
    expect(runsOn(path)).toBe(false)
  })

  it('a path that only starts like a skipped one is still guarded', () => {
    // "api/webhooks" is skipped only as a whole segment.
    for (const path of [
      '/api/webhooksx',
      '/api/queues',
      '/api/healthz',
      '/dashboard/api/webhooks',
    ]) {
      expect(runsOn(path), path).toBe(true)
    }
  })

  it('a dashboard address that ends in a static extension skips the proxy: the proxy is not the only gate', () => {
    // Known, and fine: every page and action calls requireUser() itself (their own
    // tests check that), so this only skips the early redirect and the refresh.
    expect(runsOn('/dashboard/projects/x.png')).toBe(false)
    // Other endings are not static files and are guarded.
    expect(runsOn('/dashboard/projects/x.html')).toBe(true)
    expect(runsOn('/dashboard/projects/x.php')).toBe(true)
  })
})
