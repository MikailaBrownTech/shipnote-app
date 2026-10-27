import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./env', () => ({ getSchedulingEnv: vi.fn() }))

const { createState, newPkce, STATE_TTL_MS, verifyState } =
  await import('./buffer-state')
const { createHash } = await import('node:crypto')

const A = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const B = '11111111-2222-4333-8444-555555555555'
const P = '22222222-3333-4444-8555-666666666666'
const D = '33333333-4444-4555-8666-777777777777'
const NOW = 1_800_000_000_000
const key = randomBytes(32)

function start(
  over: {
    returnTo?: { projectId: string; draftId: string | null } | null
  } = {},
) {
  const pkce = newPkce()
  const made = createState({
    userId: A,
    key,
    verifier: pkce.verifier,
    returnTo: over.returnTo ?? null,
    nowMs: NOW,
  })
  return { ...made, ...pkce }
}

const check = (
  cookieValue: string | undefined,
  state: string | null,
  over = {},
) =>
  verifyState({
    cookieValue,
    userId: A,
    key,
    returnedState: state,
    nowMs: NOW + 1000,
    ...over,
  })

describe('PKCE', () => {
  it('makes a 43 to 128 character verifier and its S256 challenge', () => {
    const { verifier, challenge } = newPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(challenge).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    )
    expect(challenge).not.toContain(verifier)
  })

  it('is different every time', () => {
    expect(newPkce().verifier).not.toBe(newPkce().verifier)
  })
})

describe('the Buffer state cookie', () => {
  it('accepts the cookie with the state Buffer sent back, and returns the verifier', () => {
    const s = start()
    expect(check(s.cookieValue, s.state)).toEqual({
      ok: true,
      verifier: s.verifier,
      returnTo: null,
    })
  })

  it('carries the project and draft the person came from', () => {
    const s = start({ returnTo: { projectId: P, draftId: D } })
    expect(check(s.cookieValue, s.state)).toMatchObject({
      ok: true,
      returnTo: { projectId: P, draftId: D },
    })
    const onlyProject = start({ returnTo: { projectId: P, draftId: null } })
    expect(check(onlyProject.cookieValue, onlyProject.state)).toMatchObject({
      ok: true,
      returnTo: { projectId: P, draftId: null },
    })
  })

  it('does not show the verifier or the state in the cookie', () => {
    const s = start()
    const text = Buffer.from(s.cookieValue, 'base64url').toString('latin1')
    expect(s.cookieValue).not.toContain(s.verifier)
    expect(text).not.toContain(s.verifier)
    expect(text).not.toContain(s.state)
  })

  it('FAILS without the state Buffer returns, or with a different one', () => {
    const s = start()
    expect(check(s.cookieValue, null)).toEqual({ ok: false })
    expect(check(s.cookieValue, '')).toEqual({ ok: false })
    expect(check(s.cookieValue, 'other')).toEqual({ ok: false })
    expect(check(s.cookieValue, `${s.state}x`)).toEqual({ ok: false })
  })

  it('FAILS with no cookie (a replay after it was cleared)', () => {
    const s = start()
    expect(check(undefined, s.state)).toEqual({ ok: false })
    expect(check('', s.state)).toEqual({ ok: false })
  })

  it('FAILS for another user (the cookie is bound to the user)', () => {
    const s = start()
    expect(check(s.cookieValue, s.state, { userId: B })).toEqual({ ok: false })
  })

  it('FAILS once it has expired, and works right up to the expiry', () => {
    const s = start()
    expect(
      check(s.cookieValue, s.state, { nowMs: NOW + STATE_TTL_MS }),
    ).toMatchObject({ ok: true })
    expect(
      check(s.cookieValue, s.state, { nowMs: NOW + STATE_TTL_MS + 1 }),
    ).toEqual({ ok: false })
  })

  it('FAILS if it was tampered with or sealed with another key', () => {
    const s = start()
    const raw = Buffer.from(s.cookieValue, 'base64url')
    raw[20] = raw[20] ^ 1
    expect(check(raw.toString('base64url'), s.state)).toEqual({ ok: false })
    expect(check(s.cookieValue, s.state, { key: randomBytes(32) })).toEqual({
      ok: false,
    })
  })

  it.each(['x', 'a.b', '{"n":1}', 'A'.repeat(3000)])(
    'FAILS for junk %#',
    (junk) => {
      expect(check(junk, 'state')).toEqual({ ok: false })
    },
  )

  it('a state from one attempt does not work with another attempt’s cookie', () => {
    const one = start()
    const two = start()
    expect(check(one.cookieValue, two.state)).toEqual({ ok: false })
  })
})
