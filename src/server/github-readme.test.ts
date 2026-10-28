import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboundFetch = vi.fn()
const getGithubEnv = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./env', () => ({ getGithubEnv }))
vi.mock('./outbound', () => ({ outboundFetch }))

const { fetchReadme, GithubError, listInstallationRepoInfo, README_MAX_BYTES } =
  await import('./github')

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const TOKEN = 'ghs_SECRET_TOKEN_VALUE'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const text = (body: BodyInit, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain' } })
const bytes = (value: string) => new TextEncoder().encode(value)

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

describe('listInstallationRepoInfo', () => {
  it('returns the name, full name and description for each repository', async () => {
    outboundFetch.mockResolvedValue(
      json(200, {
        repositories: [
          {
            full_name: 'octo/hello',
            name: 'hello',
            description: 'A greeting',
            private: true,
          },
          { full_name: 'octo/bare', name: 'bare', description: null },
          { full_name: 'octo/nodesc', name: 'nodesc' },
        ],
      }),
    )
    const blank = {
      isPrivate: false,
      language: null,
      stars: 0,
      forks: 0,
      openIssues: 0,
      updatedAt: null,
    }
    expect(await listInstallationRepoInfo(TOKEN)).toEqual([
      {
        fullName: 'octo/hello',
        name: 'hello',
        description: 'A greeting',
        ...blank,
        isPrivate: true,
      },
      { fullName: 'octo/bare', name: 'bare', description: null, ...blank },
      { fullName: 'octo/nodesc', name: 'nodesc', description: null, ...blank },
    ])
  })

  it('keeps the language, counts and last push GitHub reports for a repository', async () => {
    outboundFetch.mockResolvedValue(
      json(200, {
        repositories: [
          {
            full_name: 'octo/hello',
            name: 'hello',
            description: null,
            private: false,
            language: 'TypeScript',
            stargazers_count: 12,
            forks_count: 4,
            open_issues_count: 2,
            pushed_at: '2026-10-27T10:00:00Z',
            updated_at: '2026-10-20T10:00:00Z',
          },
          {
            full_name: 'octo/old',
            name: 'old',
            updated_at: '2026-10-20T10:00:00Z',
          },
        ],
      }),
    )
    const [first, second] = await listInstallationRepoInfo(TOKEN)
    expect(first).toMatchObject({
      language: 'TypeScript',
      stars: 12,
      forks: 4,
      openIssues: 2,
      updatedAt: '2026-10-27T10:00:00Z',
    })
    // With no push time, the last update is used.
    expect(second.updatedAt).toBe('2026-10-20T10:00:00Z')
  })

  it('refuses a count that is not a whole number', async () => {
    outboundFetch.mockResolvedValue(
      json(200, {
        repositories: [{ full_name: 'octo/hello', stargazers_count: -1 }],
      }),
    )
    await expect(listInstallationRepoInfo(TOKEN)).rejects.toBeInstanceOf(
      GithubError,
    )
  })

  it('works out the name from the full name when GitHub omits it', async () => {
    outboundFetch.mockResolvedValue(
      json(200, { repositories: [{ full_name: 'octo/hello' }] }),
    )
    const [first] = await listInstallationRepoInfo(TOKEN)
    expect(first.name).toBe('hello')
  })

  it('drops malformed names', async () => {
    outboundFetch.mockResolvedValue(
      json(200, {
        repositories: [{ full_name: 'octo/../evil' }, { full_name: 'octo/ok' }],
      }),
    )
    const found = await listInstallationRepoInfo(TOKEN)
    expect(found.map((r) => r.fullName)).toEqual(['octo/ok'])
  })
})

describe('fetchReadme', () => {
  it('asks the README endpoint for the raw file, with the repository token', async () => {
    outboundFetch.mockResolvedValue(text('# Hello'))
    expect(await fetchReadme(TOKEN, 'octo/hello')).toEqual({
      found: true,
      text: '# Hello',
      cut: false,
    })
    const { url, headers } = lastCall()
    expect(url).toBe('https://api.github.com/repos/octo/hello/readme')
    expect(headers.Accept).toBe('application/vnd.github.raw+json')
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(outboundFetch).toHaveBeenCalledOnce()
  })

  it('requests nothing but the README endpoint: no other file, diff or list', async () => {
    outboundFetch.mockResolvedValue(text('x'))
    await fetchReadme(TOKEN, 'octo/hello')
    for (const [url] of outboundFetch.mock.calls as [string][]) {
      expect(url).toMatch(/\/repos\/octo\/hello\/readme$/)
      expect(url).not.toMatch(/contents|git\/trees|compare|\.diff|commits/)
    }
  })

  it('a repository with no README is "not found", not an error', async () => {
    outboundFetch.mockResolvedValue(text('Not Found', 404))
    expect(await fetchReadme(TOKEN, 'octo/hello')).toEqual({ found: false })
  })

  it('an empty README is found, with empty text', async () => {
    outboundFetch.mockResolvedValue(text(''))
    expect(await fetchReadme(TOKEN, 'octo/hello')).toEqual({
      found: true,
      text: '',
      cut: false,
    })
  })

  it('reads at most the cap, and says it was cut', async () => {
    outboundFetch.mockResolvedValue(text('a'.repeat(README_MAX_BYTES + 5000)))
    const result = await fetchReadme(TOKEN, 'octo/hello')
    expect(result).toMatchObject({ found: true, cut: true })
    expect(result.found && result.text.length).toBe(README_MAX_BYTES)
  })

  it('a README of exactly the cap is not cut', async () => {
    outboundFetch.mockResolvedValue(text('a'.repeat(README_MAX_BYTES)))
    const result = await fetchReadme(TOKEN, 'octo/hello')
    expect(result).toMatchObject({ found: true, cut: false })
  })

  it('stops reading the stream once the cap is reached', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(bytes('b'.repeat(64 * 1024)))
        if (pulled > 200) controller.close()
      },
    })
    outboundFetch.mockResolvedValue(new Response(stream, { status: 200 }))
    const result = await fetchReadme(TOKEN, 'octo/hello')
    expect(result).toMatchObject({ found: true, cut: true })
    // 256 KB is a handful of 64 KB chunks; it must not drain all 12 MB.
    expect(pulled).toBeLessThan(20)
  })

  it('does not leave a broken character where the cap falls inside one', async () => {
    // Each rocket is 4 bytes, and the cap is not read in whole rockets.
    const rockets = '\u{1F680}'.repeat(README_MAX_BYTES / 4 + 10)
    outboundFetch.mockResolvedValue(text(rockets))
    const result = await fetchReadme(TOKEN, 'octo/hello')
    expect(result.found && result.text).not.toContain(
      String.fromCharCode(0xfffd),
    )
  })

  it('bytes that are not valid UTF-8 do not throw', async () => {
    outboundFetch.mockResolvedValue(
      text(new Uint8Array([0x48, 0x69, 0xff, 0xfe, 0x21])),
    )
    expect((await fetchReadme(TOKEN, 'octo/hello')).found).toBe(true)
  })

  it('refuses a malformed repository name without calling GitHub', async () => {
    for (const name of ['octo/../etc', 'noslash', "a/b'; drop", '']) {
      expect(await kindOf(fetchReadme(TOKEN, name))).toBe('not_found')
    }
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'denied'],
    [403, 'denied'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [418, 'failed'],
  ])('HTTP %s becomes %s', async (status, kind) => {
    outboundFetch.mockResolvedValue(text('error body', status))
    expect(await kindOf(fetchReadme(TOKEN, 'octo/hello'))).toBe(kind)
  })

  it('a network failure is "unavailable"', async () => {
    outboundFetch.mockRejectedValue(new Error('ECONNRESET'))
    expect(await kindOf(fetchReadme(TOKEN, 'octo/hello'))).toBe('unavailable')
  })

  it('a body that fails while being read is "unavailable"', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('boom')
      },
    })
    outboundFetch.mockResolvedValue(new Response(stream, { status: 200 }))
    expect(await kindOf(fetchReadme(TOKEN, 'octo/hello'))).toBe('unavailable')
  })

  it('never puts the token or any README text in an error or a log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const secretText = 'README SECRET TEXT do-not-log'

    outboundFetch.mockResolvedValue(text(`${secretText} ${TOKEN}`, 403))
    let message = ''
    try {
      await fetchReadme(TOKEN, 'octo/hello')
    } catch (error) {
      message = String(error) + ((error as Error).stack ?? '')
    }
    // A successful read must not log either.
    outboundFetch.mockResolvedValue(text(secretText))
    await fetchReadme(TOKEN, 'octo/hello')

    const everything = JSON.stringify([
      message,
      log.mock.calls,
      warn.mock.calls,
      info.mock.calls,
    ])
    expect(everything).not.toContain(TOKEN)
    expect(everything).not.toContain('do-not-log')
  })
})
