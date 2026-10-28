import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboundFetch = vi.fn()
const getGithubEnv = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./env', () => ({ getGithubEnv }))
vi.mock('./outbound', () => ({ outboundFetch }))

const { getCommit, GithubError } = await import('./github')

const SHA = 'a'.repeat(40)
const TOKEN = 'ghs_SECRET_TOKEN_VALUE'

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof GithubError ? error.kind : 'not-a-github-error'
  }
  return 'resolved'
}

beforeEach(() => {
  vi.clearAllMocks()
  getGithubEnv.mockReturnValue({ appId: '1', privateKeyPem: 'x' })
})

describe('getCommit', () => {
  it('reads one commit by its full sha with the installation token', async () => {
    outboundFetch.mockResolvedValue(
      reply(200, {
        sha: SHA.toUpperCase(),
        commit: { message: 'Add export [post]' },
        parents: [{ sha: 'b'.repeat(40) }],
        files: [{ filename: 'secret.env', patch: 'SHOULD NOT BE KEPT' }],
      }),
    )
    const commit = await getCommit(TOKEN, 'octo/hello', SHA)
    expect(commit).toEqual({
      sha: SHA,
      message: 'Add export [post]',
      parentCount: 1,
    })
    expect(JSON.stringify(commit)).not.toContain('SHOULD NOT BE KEPT')
    const [url, init] = outboundFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.github.com/repos/octo/hello/commits/${SHA}`)
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    )
  })

  it('counts the parents, so a merge commit can be told apart', async () => {
    outboundFetch.mockResolvedValue(
      reply(200, {
        sha: SHA,
        commit: { message: 'Merge pull request #1' },
        parents: [{ sha: 'b'.repeat(40) }, { sha: 'c'.repeat(40) }],
      }),
    )
    expect((await getCommit(TOKEN, 'octo/hello', SHA)).parentCount).toBe(2)
  })

  it.each([
    'abc1234',
    'A'.repeat(40),
    `${'a'.repeat(39)}/`,
    '../../x',
    '',
    `${SHA}0`,
  ])('refuses the sha %j without calling GitHub', async (sha) => {
    expect(await kindOf(getCommit(TOKEN, 'octo/hello', sha))).toBe('not_found')
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it.each(['nope', '../x/y', 'a/b/c', '', 'octo/'])(
    'refuses the repository %j without calling GitHub',
    async (repo) => {
      expect(await kindOf(getCommit(TOKEN, repo, SHA))).toBe('not_found')
      expect(outboundFetch).not.toHaveBeenCalled()
    },
  )

  it.each([
    [404, 'not_found'],
    [422, 'not_found'],
    [401, 'denied'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('a %i answer is %s', async (status, kind) => {
    outboundFetch.mockResolvedValue(reply(status))
    expect(await kindOf(getCommit(TOKEN, 'octo/hello', SHA))).toBe(kind)
  })

  it('a network failure is unavailable, and an odd body is a plain failure', async () => {
    outboundFetch.mockRejectedValue(new Error('network'))
    expect(await kindOf(getCommit(TOKEN, 'octo/hello', SHA))).toBe(
      'unavailable',
    )
    outboundFetch.mockResolvedValue(reply(200, { nothing: true }))
    expect(await kindOf(getCommit(TOKEN, 'octo/hello', SHA))).toBe('failed')
  })

  it('never puts the token or the message in an error', async () => {
    outboundFetch.mockResolvedValue(
      reply(500, { message: 'Add export [post]' }),
    )
    try {
      await getCommit(TOKEN, 'octo/hello', SHA)
      expect.unreachable()
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN)
      expect(String(error)).not.toContain('[post]')
    }
  })
})
