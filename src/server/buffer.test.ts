import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboundFetch = vi.fn()
const getSchedulingEnv = vi.fn()
const readBufferConnection = vi.fn()
const updateBufferTokens = vi.fn()
const markBufferNeedsReconnect = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./env', () => ({ getSchedulingEnv }))
vi.mock('./outbound', () => ({ outboundFetch }))
vi.mock('./supabase-admin', () => ({
  readBufferConnection,
  updateBufferTokens,
  markBufferNeedsReconnect,
}))

const {
  authorizeUrl,
  BufferError,
  createScheduledPost,
  deleteScheduledPost,
  exchangeCode,
  fetchOrganizationId,
  getPostStatus,
  listLinkedInChannels,
} = await import('./buffer')
const { openToken, sealToken } = await import('./token-vault')

const A = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const B = '11111111-2222-4333-8444-555555555555'
const NOW = Date.parse('2026-11-02T12:00:00Z')
const key = randomBytes(32)
const ACCESS_A = 'access-token-of-user-A'
const ACCESS_B = 'access-token-of-user-B'
const REFRESH_A = 'refresh-token-of-user-A'
const ACCESS_NEW = 'brand-new-access-token'
const REFRESH_NEW = 'brand-new-refresh-token'
const SECRET = 'client-secret-xyz'

function stored(
  userId: string,
  access: string,
  over: Record<string, unknown> = {},
) {
  return {
    accessTokenEnc: sealToken({ plaintext: access, userId, key }),
    refreshTokenEnc: sealToken({ plaintext: REFRESH_A, userId, key }),
    keyVersion: 1,
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    scopes: 'posts:write',
    organizationId: 'org-1',
    status: 'connected',
    ...over,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const gql = (data: unknown) => json({ data })
const gqlError = (code: string) =>
  json({ data: null, errors: [{ extensions: { code } }] })

type Call = [string, { headers?: Record<string, string>; body?: string }]
const calls = () => outboundFetch.mock.calls as Call[]
const lastBody = () =>
  JSON.parse(calls().at(-1)?.[1].body ?? '{}') as {
    query: string
    variables: Record<string, unknown>
  }

beforeEach(() => {
  vi.clearAllMocks()
  getSchedulingEnv.mockReturnValue({
    clientId: 'client-id',
    clientSecret: SECRET,
    keys: [{ version: 1, key }],
  })
  readBufferConnection.mockImplementation((userId: string) =>
    Promise.resolve(
      userId === A
        ? stored(A, ACCESS_A)
        : userId === B
          ? stored(B, ACCESS_B)
          : null,
    ),
  )
  updateBufferTokens.mockResolvedValue(true)
  markBufferNeedsReconnect.mockResolvedValue(true)
})

describe('authorizeUrl', () => {
  it('asks for the code flow with PKCE, the state, the exact redirect and offline access', () => {
    const url = new URL(
      authorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://app.example/dashboard/buffer/callback',
        state: 'st',
        challenge: 'ch',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://auth.buffer.com/auth')
    const p = url.searchParams
    expect(p.get('client_id')).toBe('cid')
    expect(p.get('redirect_uri')).toBe(
      'https://app.example/dashboard/buffer/callback',
    )
    expect(p.get('response_type')).toBe('code')
    expect(p.get('state')).toBe('st')
    expect(p.get('code_challenge')).toBe('ch')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('prompt')).toBe('consent')
    expect(p.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['posts:read', 'posts:write', 'offline_access']),
    )
    expect(url.href).not.toContain(SECRET)
  })
})

describe('exchangeCode', () => {
  const run = () =>
    exchangeCode({
      code: 'the-code',
      verifier: 'the-verifier',
      clientId: 'client-id',
      clientSecret: SECRET,
      redirectUri: 'https://app.example/dashboard/buffer/callback',
      nowMs: NOW,
    })

  it('posts the code and the PKCE verifier to the token endpoint and reads the tokens', async () => {
    outboundFetch.mockResolvedValue(
      json({
        access_token: 'acc',
        refresh_token: 'ref',
        expires_in: 3600,
        scope: 'posts:write',
      }),
    )
    const tokens = await run()
    expect(tokens).toEqual({
      accessToken: 'acc',
      refreshToken: 'ref',
      expiresAt: new Date(NOW + 3_600_000),
      scope: 'posts:write',
    })
    expect(calls()[0]?.[0]).toBe('https://auth.buffer.com/token')
    const form = new URLSearchParams(calls()[0]?.[1].body)
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://app.example/dashboard/buffer/callback',
      client_id: 'client-id',
      client_secret: SECRET,
      code_verifier: 'the-verifier',
    })
  })

  it('works without a refresh token or expiry', async () => {
    outboundFetch.mockResolvedValue(json({ access_token: 'acc' }))
    expect(await run()).toMatchObject({ refreshToken: null, expiresAt: null })
  })

  it('a refused code is a reconnect, a server error is unavailable, a limit is rate limited', async () => {
    outboundFetch.mockResolvedValue(json({ error: 'invalid_grant' }, 400))
    await expect(run()).rejects.toMatchObject({ kind: 'needs_reconnect' })
    outboundFetch.mockResolvedValue(json({}, 503))
    await expect(run()).rejects.toMatchObject({ kind: 'unavailable' })
    outboundFetch.mockResolvedValue(json({}, 429))
    await expect(run()).rejects.toMatchObject({ kind: 'rate_limited' })
    outboundFetch.mockRejectedValue(new Error('network'))
    await expect(run()).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('an odd answer is unavailable, and nothing is retried', async () => {
    outboundFetch.mockResolvedValue(json({ nothing: true }))
    await expect(run()).rejects.toMatchObject({ kind: 'unavailable' })
    outboundFetch.mockResolvedValue(new Response('not json', { status: 200 }))
    await expect(run()).rejects.toMatchObject({ kind: 'unavailable' })
    expect(outboundFetch).toHaveBeenCalledTimes(2)
  })
})

describe('using the right user’s token', () => {
  it('sends only the calling user’s token, for each user', async () => {
    outboundFetch.mockImplementation(() =>
      Promise.resolve(
        gql({ channels: [{ id: 'c', name: 'n', service: 'linkedin' }] }),
      ),
    )
    await listLinkedInChannels(A, NOW)
    await listLinkedInChannels(B, NOW)
    expect(calls().map((c) => c[1].headers?.authorization)).toEqual([
      `Bearer ${ACCESS_A}`,
      `Bearer ${ACCESS_B}`,
    ])
    expect(
      (readBufferConnection.mock.calls as [string][]).map((c) => c[0]),
    ).toEqual([A, B])
  })

  it('never uses another user’s token when the caller has no connection', async () => {
    await expect(
      listLinkedInChannels('00000000-0000-0000-0000-000000000000', NOW),
    ).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it('a token sealed for user A does not open for user B', async () => {
    readBufferConnection.mockResolvedValue(stored(A, ACCESS_A))
    await expect(listLinkedInChannels(B, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).not.toHaveBeenCalled()
    expect(markBufferNeedsReconnect).toHaveBeenCalledWith(B)
  })

  it('a connection that needs a reconnect makes no call', async () => {
    readBufferConnection.mockResolvedValue(
      stored(A, ACCESS_A, { status: 'needs_reconnect' }),
    )
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it('a token sealed with an unknown key version needs a reconnect', async () => {
    readBufferConnection.mockResolvedValue(
      stored(A, ACCESS_A, { keyVersion: 9 }),
    )
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it('the scheduling feature being off means no call at all', async () => {
    getSchedulingEnv.mockReturnValue(null)
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).not.toHaveBeenCalled()
  })
})

describe('refreshing an expired token', () => {
  const expired = () =>
    stored(A, ACCESS_A, { expiresAt: new Date(NOW + 30_000).toISOString() })

  beforeEach(() => {
    readBufferConnection.mockResolvedValue(expired())
  })

  const tokenThenChannels = () =>
    outboundFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('auth.buffer.com')
          ? json({
              access_token: ACCESS_NEW,
              refresh_token: REFRESH_NEW,
              expires_in: 3600,
            })
          : gql({ channels: [] }),
      ),
    )

  it('refreshes before the call with the refresh token and uses the new access token', async () => {
    tokenThenChannels()
    await listLinkedInChannels(A, NOW)
    const form = Object.fromEntries(new URLSearchParams(calls()[0]?.[1].body))
    expect(form).toEqual({
      grant_type: 'refresh_token',
      client_id: 'client-id',
      client_secret: SECRET,
      refresh_token: REFRESH_A,
    })
    expect(calls()[1]?.[1].headers?.authorization).toBe(`Bearer ${ACCESS_NEW}`)
  })

  it('stores the new tokens sealed for this user, never in plain text', async () => {
    tokenThenChannels()
    await listLinkedInChannels(A, NOW)
    const saved = updateBufferTokens.mock.calls[0]?.[0] as {
      userId: string
      accessTokenEnc: string
      refreshTokenEnc: string
      keyVersion: number
    }
    expect(saved.userId).toBe(A)
    expect(saved.keyVersion).toBe(1)
    expect(JSON.stringify(saved)).not.toContain(ACCESS_NEW)
    expect(JSON.stringify(saved)).not.toContain(REFRESH_NEW)
    expect(openToken({ sealed: saved.accessTokenEnc, userId: A, key })).toBe(
      ACCESS_NEW,
    )
    expect(openToken({ sealed: saved.refreshTokenEnc, userId: A, key })).toBe(
      REFRESH_NEW,
    )
    expect(() =>
      openToken({ sealed: saved.accessTokenEnc, userId: B, key }),
    ).toThrow()
  })

  it('two calls at once spend the single-use refresh token only once', async () => {
    tokenThenChannels()
    await Promise.all([
      listLinkedInChannels(A, NOW),
      listLinkedInChannels(A, NOW),
    ])
    const tokenCalls = calls().filter((c) => c[0].includes('auth.buffer.com'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('a refused refresh token marks the connection as needing a reconnect', async () => {
    outboundFetch.mockResolvedValue(json({ error: 'invalid_grant' }, 400))
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(markBufferNeedsReconnect).toHaveBeenCalledWith(A)
  })

  it('Buffer being down during a refresh does not mark it, and nothing else is called', async () => {
    outboundFetch.mockResolvedValue(json({}, 503))
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'unavailable',
    })
    expect(markBufferNeedsReconnect).not.toHaveBeenCalled()
    expect(outboundFetch).toHaveBeenCalledTimes(1)
  })

  it('new tokens that cannot be saved need a reconnect (the old refresh token is spent)', async () => {
    tokenThenChannels()
    updateBufferTokens.mockResolvedValue(false)
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(markBufferNeedsReconnect).toHaveBeenCalledWith(A)
  })

  it('an expired token with no refresh token needs a reconnect', async () => {
    readBufferConnection.mockResolvedValue(
      stored(A, ACCESS_A, {
        expiresAt: new Date(NOW - 1).toISOString(),
        refreshTokenEnc: null,
      }),
    )
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).not.toHaveBeenCalled()
  })
})

describe('reconnect after a 401', () => {
  it('a 401 or UNAUTHORIZED marks the connection and is not retried', async () => {
    outboundFetch.mockResolvedValue(json({}, 401))
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(markBufferNeedsReconnect).toHaveBeenCalledWith(A)
    outboundFetch.mockResolvedValue(gqlError('UNAUTHORIZED'))
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
    expect(outboundFetch).toHaveBeenCalledTimes(2)
  })
})

describe('channels', () => {
  it('lists LinkedIn channels only, comparing the service without case', async () => {
    outboundFetch.mockResolvedValue(
      gql({
        channels: [
          { id: '1', name: 'me', displayName: 'My Page', service: 'linkedin' },
          { id: '2', name: 'x', displayName: null, service: 'twitter' },
          { id: '3', name: 'co', displayName: null, service: 'LinkedIn' },
        ],
      }),
    )
    expect(await listLinkedInChannels(A, NOW)).toEqual([
      { id: '1', label: 'My Page' },
      { id: '3', label: 'co' },
    ])
    expect(lastBody().variables).toEqual({ organizationId: 'org-1' })
  })

  it('without an organization id it needs a reconnect', async () => {
    readBufferConnection.mockResolvedValue(
      stored(A, ACCESS_A, { organizationId: null }),
    )
    await expect(listLinkedInChannels(A, NOW)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
  })

  it('reads the organization id at connect time', async () => {
    outboundFetch.mockResolvedValue(
      gql({ account: { organizations: [{ id: 'org-9' }, { id: 'org-2' }] } }),
    )
    expect(await fetchOrganizationId('fresh-token')).toBe('org-9')
    expect(calls()[0]?.[1].headers?.authorization).toBe('Bearer fresh-token')
    outboundFetch.mockResolvedValue(gql({ account: { organizations: [] } }))
    expect(await fetchOrganizationId('fresh-token')).toBeNull()
  })
})

describe('createScheduledPost', () => {
  const input = {
    userId: A,
    channelId: 'chan-1',
    text: 'The exact\n text',
    dueAt: new Date('2026-11-10T14:30:00Z'),
    nowMs: NOW,
  }
  const ok = () =>
    outboundFetch.mockResolvedValue(
      gql({
        createPost: { __typename: 'PostActionSuccess', post: { id: 'bp-1' } },
      }),
    )

  it('sends the exact text, channel and time once, as customScheduled', async () => {
    ok()
    expect(await createScheduledPost(input)).toEqual({ postId: 'bp-1' })
    expect(outboundFetch).toHaveBeenCalledOnce()
    expect(lastBody().variables).toEqual({
      input: {
        text: 'The exact\n text',
        channelId: 'chan-1',
        schedulingType: 'automatic',
        mode: 'customScheduled',
        dueAt: '2026-11-10T14:30:00.000Z',
      },
    })
    // The text goes in a variable, never spliced into the query.
    expect(lastBody().query).not.toContain('The exact')
  })

  it('hostile text is passed as plain data, unchanged', async () => {
    ok()
    const text =
      '"}) { id } mutation { deletePost(input:{id:"x"}) { __typename } } #'
    await createScheduledPost({ ...input, text })
    expect(lastBody().variables).toMatchObject({ input: { text } })
    expect(lastBody().query).not.toContain('deletePost')
  })

  it.each([
    ['LimitReachedError', 'limit_reached'],
    ['InvalidInputError', 'invalid'],
    ['MutationError', 'invalid'],
  ])('a typed %s is %s and nothing is retried', async (typename, kind) => {
    outboundFetch.mockResolvedValue(
      gql({ createPost: { __typename: typename } }),
    )
    await expect(createScheduledPost(input)).rejects.toMatchObject({ kind })
    expect(outboundFetch).toHaveBeenCalledOnce()
  })

  it('a rate limit or a refused token is known not to have scheduled anything', async () => {
    outboundFetch.mockResolvedValue(json({}, 429))
    await expect(createScheduledPost(input)).rejects.toMatchObject({
      kind: 'rate_limited',
    })
    outboundFetch.mockResolvedValue(gqlError('RATE_LIMIT_EXCEEDED'))
    await expect(createScheduledPost(input)).rejects.toMatchObject({
      kind: 'rate_limited',
    })
    outboundFetch.mockResolvedValue(json({}, 401))
    await expect(createScheduledPost(input)).rejects.toMatchObject({
      kind: 'needs_reconnect',
    })
  })

  it.each([
    [
      'a timeout',
      () =>
        Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
    ],
    ['a server error', () => Promise.resolve(json({}, 502))],
    [
      'an unreadable answer',
      () => Promise.resolve(new Response('<html>', { status: 200 })),
    ],
    ['an UNEXPECTED error', () => Promise.resolve(gqlError('UNEXPECTED'))],
    [
      'a success without a post',
      () =>
        Promise.resolve(
          gql({ createPost: { __typename: 'PostActionSuccess' } }),
        ),
    ],
    [
      'an unknown union member',
      () => Promise.resolve(gql({ createPost: { __typename: 'Mystery' } })),
    ],
  ])(
    '%s is an unknown result, and is never retried',
    async (_label, answer) => {
      outboundFetch.mockImplementation(answer)
      await expect(createScheduledPost(input)).rejects.toMatchObject({
        kind: 'unknown_result',
      })
      expect(outboundFetch).toHaveBeenCalledOnce()
    },
  )

  it('a network failure before an answer is unavailable (nothing reached Buffer)', async () => {
    outboundFetch.mockRejectedValue(new Error('ECONNRESET'))
    await expect(createScheduledPost(input)).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })
})

describe('deleteScheduledPost and getPostStatus', () => {
  it('deletes by id', async () => {
    outboundFetch.mockResolvedValue(
      gql({ deletePost: { __typename: 'DeletePostSuccess' } }),
    )
    expect(await deleteScheduledPost(A, 'bp-1', NOW)).toBe('deleted')
    expect(lastBody().variables).toEqual({ input: { id: 'bp-1' } })
  })

  it('a refusal is invalid, and a missing post is not_found', async () => {
    outboundFetch.mockResolvedValue(
      gql({ deletePost: { __typename: 'MutationError' } }),
    )
    await expect(deleteScheduledPost(A, 'bp-1', NOW)).rejects.toMatchObject({
      kind: 'invalid',
    })
    outboundFetch.mockResolvedValue(gqlError('NOT_FOUND'))
    await expect(deleteScheduledPost(A, 'bp-1', NOW)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it.each([
    ['scheduled', 'scheduled'],
    ['sent', 'sent'],
    ['error', 'error'],
    ['draft', 'other'],
    ['needsApproval', 'other'],
  ])('status %s reads as %s', async (status, expected) => {
    outboundFetch.mockResolvedValue(gql({ post: { status } }))
    expect(await getPostStatus(A, 'bp-1', NOW)).toBe(expected)
  })

  it('a missing post status call is not_found', async () => {
    outboundFetch.mockResolvedValue(gqlError('NOT_FOUND'))
    await expect(getPostStatus(A, 'bp-1', NOW)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })
})

describe('secrets', () => {
  it('no token, secret or body text is in logs or errors', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const errors: unknown[] = []
    outboundFetch.mockResolvedValue(gqlError('UNEXPECTED'))
    for (const run of [
      () =>
        createScheduledPost({
          userId: A,
          channelId: 'c',
          text: 'PRIVATE POST TEXT',
          dueAt: new Date(NOW + 9e8),
          nowMs: NOW,
        }),
      () => listLinkedInChannels(A, NOW),
      () =>
        exchangeCode({
          code: 'CODE-123',
          verifier: 'VERIFIER-123',
          clientId: 'client-id',
          clientSecret: SECRET,
          redirectUri: 'https://x/y',
        }),
    ]) {
      try {
        await run()
      } catch (error) {
        errors.push(error)
      }
    }
    const seen = JSON.stringify([
      spies.map((s) => s.mock.calls),
      errors.map((e) => String(e)),
    ])
    for (const secret of [
      ACCESS_A,
      REFRESH_A,
      SECRET,
      'PRIVATE POST TEXT',
      'CODE-123',
      'VERIFIER-123',
    ]) {
      expect(seen).not.toContain(secret)
    }
    expect(errors.every((e) => e instanceof BufferError)).toBe(true)
  })
})
