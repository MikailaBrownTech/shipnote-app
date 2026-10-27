import { beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeUserCode = vi.fn()
const getUser = vi.fn()
const listUserInstallations = vi.fn()
const revokeUserToken = vi.fn()

class GithubError extends Error {
  kind: string
  constructor(kind: string) {
    super(`GitHub request failed: ${kind}`)
    this.kind = kind
  }
}

vi.mock('server-only', () => ({}))
vi.mock('./github', () => ({
  exchangeUserCode,
  getUser,
  listUserInstallations,
  revokeUserToken,
  GithubError,
}))

const { verifyInstallation } = await import('./github-connect')

const TOKEN = 'ghu_USER_TOKEN_VALUE'
const ME = { id: 7, login: 'octo' }
const mine = { id: 42, account: { id: 7, login: 'octo', type: 'User' } }
const someoneElses = {
  id: 99,
  account: { id: 8, login: 'mallory', type: 'User' },
}
const anOrg = {
  id: 55,
  account: { id: 500, login: 'acme', type: 'Organization' },
}

describe('verifyInstallation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exchangeUserCode.mockResolvedValue(TOKEN)
    getUser.mockResolvedValue(ME)
    listUserInstallations.mockResolvedValue([mine])
    revokeUserToken.mockResolvedValue(true)
  })

  it('accepts an installation that is on the user’s own list and account', async () => {
    const result = await verifyInstallation({
      code: 'c',
      claimedInstallationId: 42,
    })
    expect(result).toEqual({
      ok: true,
      installation: { installationId: 42, accountLogin: 'octo', accountId: 7 },
    })
  })

  it('REJECTS a forged installation id that is not on the user’s list', async () => {
    const result = await verifyInstallation({
      code: 'c',
      claimedInstallationId: 99,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects an id that exists on GitHub but belongs to another person', async () => {
    // Even if GitHub listed it, a personal installation on someone else's
    // account is not this person's.
    listUserInstallations.mockResolvedValue([mine, someoneElses])
    const result = await verifyInstallation({
      code: 'c',
      claimedInstallationId: 99,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('does not trust the id from the URL on its own: ownership comes from the list', async () => {
    listUserInstallations.mockResolvedValue([])
    expect(
      await verifyInstallation({ code: 'c', claimedInstallationId: 42 }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(exchangeUserCode).toHaveBeenCalledOnce()
    expect(listUserInstallations).toHaveBeenCalledWith(TOKEN)
  })

  it('an organization installation is not supported, and nothing is accepted', async () => {
    listUserInstallations.mockResolvedValue([mine, anOrg])
    expect(
      await verifyInstallation({ code: 'c', claimedInstallationId: 55 }),
    ).toEqual({
      ok: false,
      reason: 'org',
    })
  })

  describe('when the URL carries no installation id', () => {
    it('uses the one personal installation of this GitHub user', async () => {
      listUserInstallations.mockResolvedValue([anOrg, mine])
      const result = await verifyInstallation({
        code: 'c',
        claimedInstallationId: null,
      })
      expect(result).toMatchObject({
        ok: true,
        installation: { installationId: 42 },
      })
    })

    it('says "org" when the user only has organization installations', async () => {
      listUserInstallations.mockResolvedValue([anOrg])
      expect(
        await verifyInstallation({ code: 'c', claimedInstallationId: null }),
      ).toEqual({
        ok: false,
        reason: 'org',
      })
    })

    it('refuses when the user has none', async () => {
      listUserInstallations.mockResolvedValue([])
      expect(
        await verifyInstallation({ code: 'c', claimedInstallationId: null }),
      ).toEqual({
        ok: false,
        reason: 'invalid',
      })
    })

    it('never picks another person’s personal installation', async () => {
      listUserInstallations.mockResolvedValue([someoneElses])
      const result = await verifyInstallation({
        code: 'c',
        claimedInstallationId: null,
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('the user token', () => {
    it.each([
      ['accepted', () => undefined],
      ['forged id', () => listUserInstallations.mockResolvedValue([])],
      ['organization', () => listUserInstallations.mockResolvedValue([anOrg])],
      [
        'GitHub error',
        () =>
          listUserInstallations.mockRejectedValue(
            new GithubError('unavailable'),
          ),
      ],
      [
        'user lookup error',
        () => getUser.mockRejectedValue(new GithubError('denied')),
      ],
    ])('is revoked exactly once after: %s', async (_label, arrange) => {
      arrange()
      await verifyInstallation({ code: 'c', claimedInstallationId: 42 })
      expect(revokeUserToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    })

    it('is never created, or revoked, if the code is refused', async () => {
      exchangeUserCode.mockRejectedValue(new GithubError('denied'))
      expect(
        await verifyInstallation({ code: 'c', claimedInstallationId: 42 }),
      ).toEqual({
        ok: false,
        reason: 'denied',
      })
      expect(getUser).not.toHaveBeenCalled()
      expect(revokeUserToken).not.toHaveBeenCalled()
    })

    it('does not change the answer if revoking fails', async () => {
      revokeUserToken.mockResolvedValue(false)
      const result = await verifyInstallation({
        code: 'c',
        claimedInstallationId: 42,
      })
      expect(result.ok).toBe(true)
    })

    it('never appears in a result', async () => {
      for (const arrange of [
        () => undefined,
        () => listUserInstallations.mockResolvedValue([]),
        () => getUser.mockRejectedValue(new GithubError('unavailable')),
      ]) {
        arrange()
        const result = await verifyInstallation({
          code: 'c',
          claimedInstallationId: 42,
        })
        expect(JSON.stringify(result)).not.toContain(TOKEN)
      }
    })
  })

  describe('GitHub trouble maps to a plain reason', () => {
    it.each([
      ['unavailable', 'unavailable'],
      ['rate_limited', 'rate_limited'],
      ['denied', 'denied'],
      ['failed', 'failed'],
      ['not_found', 'failed'],
    ])('%s becomes %s', async (kind, reason) => {
      listUserInstallations.mockRejectedValue(new GithubError(kind))
      expect(
        await verifyInstallation({ code: 'c', claimedInstallationId: 42 }),
      ).toEqual({
        ok: false,
        reason,
      })
    })

    it('an unexpected error is a generic failure', async () => {
      getUser.mockRejectedValue(new Error('boom'))
      expect(
        await verifyInstallation({ code: 'c', claimedInstallationId: 42 }),
      ).toEqual({
        ok: false,
        reason: 'failed',
      })
    })
  })
})
