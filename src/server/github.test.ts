import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboundFetch = vi.fn()
const getGithubEnv = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./env', () => ({ getGithubEnv }))
vi.mock('./outbound', () => ({ outboundFetch }))

const {
  createAppJwt,
  createInstallationToken,
  exchangeUserCode,
  getUser,
  GithubError,
  listInstallationRepos,
  listRecentCommits,
  listUserInstallations,
  revokeUserToken,
} = await import('./github')

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const SECRET_TOKEN = 'ghs_SECRET_TOKEN_VALUE'

function reply(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const lastCall = () => {
  const [url, init] = outboundFetch.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, headers: init.headers as Record<string, string> }
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error instanceof GithubError ? error.kind : 'not-a-github-error'
  }
  return 'resolved'
}

describe('github client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGithubEnv.mockReturnValue({
      appId: '123456',
      slug: 'shipnote-dev',
      clientId: 'Iv1.client',
      clientSecret: 'client-secret',
      privateKeyPem: privateKey,
    })
  })

  describe('createAppJwt', () => {
    it('is a valid RS256 JWT with the documented claims', () => {
      const now = 1_800_000_000_000
      const jwt = createAppJwt('123456', privateKey, now)
      const [header, payload, signature] = jwt.split('.') as [
        string,
        string,
        string,
      ]
      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
        alg: 'RS256',
        typ: 'JWT',
      })
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
        iat: 1_800_000_000 - 60,
        exp: 1_800_000_000 + 540,
        iss: '123456',
      })
      const ok = createVerify('RSA-SHA256')
        .update(`${header}.${payload}`)
        .verify(createPublicKey(publicKey), Buffer.from(signature, 'base64url'))
      expect(ok).toBe(true)
    })

    it('lives at most 10 minutes', () => {
      const [, payload] = createAppJwt(
        '1',
        privateKey,
        1_800_000_000_000,
      ).split('.') as [string, string]
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as { iat: number; exp: number }
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60 + 60)
      expect(claims.exp - 1_800_000_000).toBeLessThanOrEqual(10 * 60)
    })
  })

  describe('user authorization', () => {
    it('exchanges the code on github.com with the client credentials', async () => {
      outboundFetch.mockResolvedValue(reply(200, { access_token: 'ghu_abc' }))
      expect(await exchangeUserCode('the-code')).toBe('ghu_abc')
      const { url, init } = lastCall()
      expect(url).toBe('https://github.com/login/oauth/access_token')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'the-code',
      })
    })

    it('a bad or reused code (200 with an error field) is denied', async () => {
      outboundFetch.mockResolvedValue(
        reply(200, { error: 'bad_verification_code' }),
      )
      expect(await kindOf(exchangeUserCode('x'))).toBe('denied')
    })

    it('reads the GitHub user and the installations list', async () => {
      outboundFetch.mockResolvedValueOnce(reply(200, { id: 7, login: 'octo' }))
      expect(await getUser('ghu_abc')).toEqual({ id: 7, login: 'octo' })
      expect(lastCall().headers.Authorization).toBe('Bearer ghu_abc')

      outboundFetch.mockResolvedValueOnce(
        reply(200, {
          total_count: 1,
          installations: [
            {
              id: 42,
              extra: 'ignored',
              account: { id: 7, login: 'octo', type: 'User', more: 1 },
            },
          ],
        }),
      )
      expect(await listUserInstallations('ghu_abc')).toEqual([
        { id: 42, account: { id: 7, login: 'octo', type: 'User' } },
      ])
      expect(lastCall().url).toContain(
        'https://api.github.com/user/installations',
      )
    })

    it('revokes the user token with basic auth, and never throws', async () => {
      outboundFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
      expect(await revokeUserToken('ghu_abc')).toBe(true)
      const { url, init, headers } = lastCall()
      expect(url).toBe('https://api.github.com/applications/Iv1.client/token')
      expect(init.method).toBe('DELETE')
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from('Iv1.client:client-secret').toString('base64')}`,
      )
      expect(JSON.parse(init.body as string)).toEqual({
        access_token: 'ghu_abc',
      })

      outboundFetch.mockRejectedValueOnce(new Error('network'))
      expect(await revokeUserToken('ghu_abc')).toBe(false)
      outboundFetch.mockResolvedValueOnce(reply(422))
      expect(await revokeUserToken('ghu_abc')).toBe(false)
    })
  })

  describe('installation tokens', () => {
    it('limits a repo token to that repository and to Contents + Metadata read', async () => {
      outboundFetch.mockResolvedValue(reply(201, { token: SECRET_TOKEN }))
      expect(await createInstallationToken(42, 'octo/hello')).toBe(SECRET_TOKEN)
      const { url, init, headers } = lastCall()
      expect(url).toBe(
        'https://api.github.com/app/installations/42/access_tokens',
      )
      expect(JSON.parse(init.body as string)).toEqual({
        repositories: ['hello'],
        permissions: { contents: 'read', metadata: 'read' },
      })
      // The JWT identifies the App.
      expect(headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    })

    it('without a repo, asks for Metadata read only', async () => {
      outboundFetch.mockResolvedValue(reply(201, { token: SECRET_TOKEN }))
      await createInstallationToken(42)
      expect(JSON.parse(lastCall().init.body as string)).toEqual({
        permissions: { metadata: 'read' },
      })
    })

    it('never asks for write permissions', async () => {
      outboundFetch.mockImplementation(() =>
        Promise.resolve(reply(201, { token: SECRET_TOKEN })),
      )
      await createInstallationToken(42, 'octo/hello')
      await createInstallationToken(42)
      for (const [, init] of outboundFetch.mock.calls as [
        string,
        RequestInit,
      ][]) {
        expect(init.body as string).not.toMatch(/write|admin/)
      }
    })

    it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
      'refuses the installation id %s without calling GitHub',
      async (id) => {
        expect(await kindOf(createInstallationToken(id))).toBe('not_installed')
        expect(outboundFetch).not.toHaveBeenCalled()
      },
    )

    it.each([
      [404, 'not_installed'],
      [403, 'not_installed'],
    ])(
      'a %s from GitHub means the installation is gone',
      async (status, kind) => {
        outboundFetch.mockResolvedValue(reply(status))
        expect(await kindOf(createInstallationToken(42))).toBe(kind)
      },
    )

    it('a rate limit is not mistaken for a missing installation', async () => {
      outboundFetch.mockResolvedValue(
        reply(403, {}, { 'x-ratelimit-remaining': '0' }),
      )
      expect(await kindOf(createInstallationToken(42))).toBe('rate_limited')
    })
  })

  describe('listing repositories', () => {
    it('returns only well-formed repository names', async () => {
      outboundFetch.mockResolvedValue(
        reply(200, {
          repositories: [
            { full_name: 'octo/hello' },
            { full_name: 'octo/../evil' },
            { full_name: 'no-slash' },
            { full_name: "octo/x'; drop" },
            { full_name: 'octo/.github' },
          ],
        }),
      )
      expect(await listInstallationRepos(SECRET_TOKEN)).toEqual([
        'octo/hello',
        'octo/.github',
      ])
    })
  })

  describe('listing commits', () => {
    it('keeps only sha, message and author date, never diffs or files', async () => {
      outboundFetch.mockResolvedValue(
        reply(200, [
          {
            sha: 'a'.repeat(40),
            html_url: 'https://evil.test/',
            files: [{ filename: 'secret.env', patch: '+KEY=1' }],
            stats: { total: 9 },
            commit: {
              message: 'Add thing [post]\n\nbody',
              author: { date: '2026-10-20T10:00:00Z', email: 'a@b.co' },
            },
          },
        ]),
      )
      const commits = await listRecentCommits(
        SECRET_TOKEN,
        'octo/hello',
        '2026-09-27T00:00:00Z',
      )
      expect(commits).toEqual([
        {
          sha: 'a'.repeat(40),
          message: 'Add thing [post]\n\nbody',
          date: '2026-10-20T10:00:00Z',
        },
      ])
      expect(JSON.stringify(commits)).not.toMatch(/secret\.env|evil|a@b\.co/)
      const { url, headers } = lastCall()
      expect(url).toBe(
        'https://api.github.com/repos/octo/hello/commits?since=2026-09-27T00%3A00%3A00Z&per_page=100',
      )
      expect(headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`)
    })

    it('a commit without an author date still comes back', async () => {
      outboundFetch.mockResolvedValue(
        reply(200, [
          { sha: 'b'.repeat(40), commit: { message: 'x', author: null } },
        ]),
      )
      const [commit] = await listRecentCommits(SECRET_TOKEN, 'octo/hello', 'z')
      expect(commit.date).toBeNull()
    })

    it('an empty repository (409) is an empty list', async () => {
      outboundFetch.mockResolvedValue(reply(409))
      expect(await listRecentCommits(SECRET_TOKEN, 'octo/hello', 'z')).toEqual(
        [],
      )
    })

    it('a repository that is gone is not_found', async () => {
      outboundFetch.mockResolvedValue(reply(404))
      expect(
        await kindOf(listRecentCommits(SECRET_TOKEN, 'octo/hello', 'z')),
      ).toBe('not_found')
    })

    it('a malformed repository name never reaches GitHub', async () => {
      expect(
        await kindOf(listRecentCommits(SECRET_TOKEN, 'octo/../x', 'z')),
      ).toBe('not_found')
      expect(outboundFetch).not.toHaveBeenCalled()
    })

    it('a response of the wrong shape is a failure, not a crash', async () => {
      outboundFetch.mockResolvedValue(reply(200, { not: 'an array' }))
      expect(
        await kindOf(listRecentCommits(SECRET_TOKEN, 'octo/hello', 'z')),
      ).toBe('failed')
    })
  })

  describe('errors', () => {
    it.each([
      [401, {}, 'denied'],
      [403, {}, 'denied'],
      [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
      [403, { 'retry-after': '30' }, 'rate_limited'],
      [429, {}, 'rate_limited'],
      [404, {}, 'not_found'],
      [500, {}, 'unavailable'],
      [502, {}, 'unavailable'],
      [503, {}, 'unavailable'],
      [418, {}, 'failed'],
    ])('maps HTTP %s %j to %s', async (status, headers, kind) => {
      outboundFetch.mockResolvedValue(reply(status, {}, headers))
      expect(await kindOf(getUser('ghu_abc'))).toBe(kind)
    })

    it('a network failure, timeout or refused host is "unavailable"', async () => {
      outboundFetch.mockRejectedValue(new Error('ECONNRESET'))
      expect(await kindOf(getUser('ghu_abc'))).toBe('unavailable')
    })

    it('never puts a token, a response body or a URL into an error or a log', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      outboundFetch.mockResolvedValue(
        reply(401, {
          message: `Bad credentials for ${SECRET_TOKEN}`,
          documentation_url: 'https://docs.github.com/secret-path',
        }),
      )
      const messages: string[] = []
      for (const call of [
        () => getUser(SECRET_TOKEN),
        () => listInstallationRepos(SECRET_TOKEN),
        () => listRecentCommits(SECRET_TOKEN, 'octo/hello', 'z'),
        () => exchangeUserCode(SECRET_TOKEN),
      ]) {
        try {
          await call()
        } catch (error) {
          messages.push(String(error), (error as Error).stack ?? '')
        }
      }
      const everything = JSON.stringify([
        messages,
        log.mock.calls,
        warn.mock.calls,
      ])
      expect(everything).not.toContain(SECRET_TOKEN)
      expect(everything).not.toContain('secret-path')
      expect(everything).not.toContain('Bad credentials')
    })

    it('is not usable while the feature is off', async () => {
      getGithubEnv.mockReturnValue(null)
      await expect(exchangeUserCode('x')).rejects.toThrow(
        'GitHub is not enabled',
      )
    })
  })
})
