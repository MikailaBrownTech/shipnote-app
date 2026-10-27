import 'server-only'
import { z } from 'zod'
import { getSchedulingEnv } from './env'
import { outboundFetch } from './outbound'
import {
  markBufferNeedsReconnect,
  readBufferConnection,
  updateBufferTokens,
} from './supabase-admin'
import { keyForVersion, openToken, sealToken, VaultError } from './token-vault'

// The only module that talks to Buffer. Every call takes the user id and uses
// that user's own tokens, loaded from the vault and decrypted only here, only
// for the call. A token never leaves this module: it is not returned, logged
// or put in an error.
//
// Buffer's GraphQL API always answers HTTP 200 with typed errors in the body,
// so the response is read as data. Nothing here logs, and errors carry only a
// fixed kind. A response body is never put in an error.
//
// There is no retry after a post may have been accepted: see createScheduledPost.

export type BufferFailure =
  | 'needs_reconnect' // no connection, a refused token, or a failed refresh
  | 'rate_limited'
  | 'limit_reached' // the user's Buffer plan or channel limit
  | 'invalid' // Buffer refused the input
  | 'not_found'
  | 'unavailable' // Buffer did not answer, or answered with a server error
  | 'unknown_result' // the request may or may not have taken effect

export class BufferError extends Error {
  readonly kind: BufferFailure
  constructor(kind: BufferFailure) {
    super(`Buffer request failed: ${kind}`)
    this.name = 'BufferError'
    this.kind = kind
  }
}

const API = 'https://api.buffer.com/'
const TOKEN_URL = 'https://auth.buffer.com/token'
const AUTHORIZE_URL = 'https://auth.buffer.com/auth'
// offline_access is what makes Buffer return a refresh token.
export const SCOPES = 'posts:read posts:write account:read offline_access'
const API_TIMEOUT_MS = 15_000
// Refresh a little before the token expires.
const REFRESH_MARGIN_MS = 60_000

const timedOut = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'TimeoutError' || error.name === 'AbortError')

// ---- OAuth ----

export function authorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Always show the consent screen, so a person can pick a different Buffer
  // account when they reconnect.
  url.searchParams.set('prompt', 'consent')
  return url.href
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).nullish(),
  expires_in: z.number().int().positive().nullish(),
  scope: z.string().nullish(),
})

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string | null
}

async function tokenRequest(
  form: Record<string, string>,
  nowMs: number,
): Promise<TokenSet> {
  let response: Response
  try {
    response = await outboundFetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      timeoutMs: API_TIMEOUT_MS,
    })
  } catch {
    throw new BufferError('unavailable')
  }
  if (response.status === 429) throw new BufferError('rate_limited')
  if (response.status >= 500) throw new BufferError('unavailable')
  // A 4xx here is a bad or used code, or a refused refresh token.
  if (!response.ok) throw new BufferError('needs_reconnect')
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new BufferError('unavailable')
  }
  const parsed = tokenResponse.safeParse(body)
  if (!parsed.success) throw new BufferError('unavailable')
  const { access_token, refresh_token, expires_in, scope } = parsed.data
  return {
    accessToken: access_token,
    refreshToken: refresh_token ?? null,
    expiresAt: expires_in ? new Date(nowMs + expires_in * 1000) : null,
    scope: scope ?? null,
  }
}

// Trades the one-time code (and the PKCE verifier) for tokens.
export function exchangeCode(input: {
  code: string
  verifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
  nowMs?: number
}): Promise<TokenSet> {
  return tokenRequest(
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code_verifier: input.verifier,
    },
    input.nowMs ?? Date.now(),
  )
}

// ---- GraphQL ----

const graphqlResponse = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z
    .array(
      z.object({
        extensions: z.object({ code: z.string().optional() }).nullish(),
      }),
    )
    .nullish(),
})

// Runs one GraphQL request with a token. `sent` is true once the request left,
// so the caller can tell "refused before it ran" from "may have run".
async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await outboundFetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      timeoutMs: API_TIMEOUT_MS,
    })
  } catch (error) {
    // Cannot tell whether Buffer saw it.
    throw new BufferError(timedOut(error) ? 'unknown_result' : 'unavailable')
  }
  if (response.status === 401) throw new BufferError('needs_reconnect')
  if (response.status === 429) throw new BufferError('rate_limited')
  if (response.status >= 500) throw new BufferError('unknown_result')
  if (!response.ok) throw new BufferError('invalid')

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new BufferError('unknown_result')
  }
  const parsed = graphqlResponse.safeParse(body)
  if (!parsed.success) throw new BufferError('unknown_result')

  const code = parsed.data.errors?.[0]?.extensions?.code
  if (code === 'UNAUTHORIZED') throw new BufferError('needs_reconnect')
  if (code === 'FORBIDDEN') throw new BufferError('needs_reconnect')
  if (code === 'NOT_FOUND') throw new BufferError('not_found')
  if (code === 'RATE_LIMIT_EXCEEDED') throw new BufferError('rate_limited')
  if (code !== undefined) throw new BufferError('unknown_result')
  if (parsed.data.errors && parsed.data.errors.length > 0) {
    throw new BufferError('unknown_result')
  }
  if (!parsed.data.data) throw new BufferError('unknown_result')
  return parsed.data.data
}

// ---- Tokens for one user ----

// Two refreshes at once would each spend the single-use refresh token and
// Buffer would revoke the grant, so one user refreshes one at a time in this
// process. (Separate server instances are not covered; see the README.)
const refreshing = new Map<string, Promise<string>>()

async function refreshFor(
  userId: string,
  refreshToken: string,
  nowMs: number,
): Promise<string> {
  const settings = getSchedulingEnv()
  const current = settings?.keys[0]
  if (!settings || !current) throw new BufferError('needs_reconnect')

  let tokens: TokenSet
  try {
    tokens = await tokenRequest(
      {
        grant_type: 'refresh_token',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        refresh_token: refreshToken,
      },
      nowMs,
    )
  } catch (error) {
    if (error instanceof BufferError && error.kind === 'needs_reconnect') {
      await markBufferNeedsReconnect(userId)
    }
    throw error
  }

  const stored = await updateBufferTokens({
    userId,
    accessTokenEnc: sealToken({
      plaintext: tokens.accessToken,
      userId,
      key: current.key,
    }),
    refreshTokenEnc: tokens.refreshToken
      ? sealToken({ plaintext: tokens.refreshToken, userId, key: current.key })
      : null,
    keyVersion: current.version,
    expiresAt: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
  })
  // The old refresh token is spent, so a token that was not saved is lost: the
  // person has to reconnect.
  if (!stored) {
    await markBufferNeedsReconnect(userId)
    throw new BufferError('needs_reconnect')
  }
  return tokens.accessToken
}

type Access = { token: string; organizationId: string | null }

// A usable access token for this user and only this user, refreshed if it is
// about to expire.
async function accessFor(userId: string, nowMs: number): Promise<Access> {
  const settings = getSchedulingEnv()
  if (!settings) throw new BufferError('needs_reconnect')
  const connection = await readBufferConnection(userId)
  if (!connection || connection.status !== 'connected') {
    throw new BufferError('needs_reconnect')
  }
  const key = keyForVersion(settings.keys, connection.keyVersion)
  if (!key) throw new BufferError('needs_reconnect')

  const expiresMs = connection.expiresAt
    ? Date.parse(connection.expiresAt)
    : Number.POSITIVE_INFINITY
  if (expiresMs - nowMs > REFRESH_MARGIN_MS) {
    try {
      return {
        token: openToken({ sealed: connection.accessTokenEnc, userId, key }),
        organizationId: connection.organizationId,
      }
    } catch (error) {
      if (!(error instanceof VaultError)) throw error
      await markBufferNeedsReconnect(userId)
      throw new BufferError('needs_reconnect')
    }
  }

  if (!connection.refreshTokenEnc) {
    await markBufferNeedsReconnect(userId)
    throw new BufferError('needs_reconnect')
  }
  let refreshToken: string
  try {
    refreshToken = openToken({
      sealed: connection.refreshTokenEnc,
      userId,
      key,
    })
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    await markBufferNeedsReconnect(userId)
    throw new BufferError('needs_reconnect')
  }
  let pending = refreshing.get(userId)
  if (!pending) {
    pending = refreshFor(userId, refreshToken, nowMs).finally(() => {
      refreshing.delete(userId)
    })
    refreshing.set(userId, pending)
  }
  return { token: await pending, organizationId: connection.organizationId }
}

// Runs a call with the user's token. A refused token marks the connection as
// needing a reconnect.
async function withAccess<T>(
  userId: string,
  nowMs: number,
  call: (access: Access) => Promise<T>,
): Promise<T> {
  const access = await accessFor(userId, nowMs)
  try {
    return await call(access)
  } catch (error) {
    if (error instanceof BufferError && error.kind === 'needs_reconnect') {
      await markBufferNeedsReconnect(userId)
    }
    throw error
  }
}

// ---- What Shipnote asks Buffer ----

const organizationsData = z.object({
  account: z.object({
    organizations: z.array(z.object({ id: z.string().min(1) })),
  }),
})

// At connect time, with the brand-new token (before it is stored).
export async function fetchOrganizationId(
  accessToken: string,
): Promise<string | null> {
  const data = await graphql(
    accessToken,
    'query Organizations { account { organizations { id } } }',
    {},
  )
  const parsed = organizationsData.safeParse(data)
  if (!parsed.success) throw new BufferError('unknown_result')
  return parsed.data.account.organizations[0]?.id ?? null
}

export type Channel = { id: string; label: string }

const channelsData = z.object({
  channels: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().nullish(),
      displayName: z.string().nullish(),
      service: z.string(),
    }),
  ),
})

// The user's LinkedIn channels only. The service name is compared without case.
export async function listLinkedInChannels(
  userId: string,
  nowMs = Date.now(),
): Promise<Channel[]> {
  return withAccess(userId, nowMs, async ({ token, organizationId }) => {
    if (!organizationId) throw new BufferError('needs_reconnect')
    const data = await graphql(
      token,
      `
        query Channels($organizationId: OrganizationId!) {
          channels(input: { organizationId: $organizationId }) {
            id
            name
            displayName
            service
          }
        }
      `,
      { organizationId },
    )
    const parsed = channelsData.safeParse(data)
    if (!parsed.success) throw new BufferError('unknown_result')
    return parsed.data.channels
      .filter((channel) => channel.service.toLowerCase() === 'linkedin')
      .map((channel) => ({
        id: channel.id,
        label: (channel.displayName ?? channel.name ?? 'LinkedIn').slice(0, 80),
      }))
  })
}

const createData = z.object({
  createPost: z.object({
    __typename: z.string(),
    post: z.object({ id: z.string().min(1) }).nullish(),
  }),
})

// Schedules one text post at an exact time. ONE request, never repeated.
//
//   - Refused before it ran (bad token, rate limit, a typed error such as a
//     plan limit): the BufferError says which, and nothing was scheduled.
//   - Anything else (a timeout, a server error, an unreadable answer) throws
//     'unknown_result': Buffer may have scheduled the post. The caller must
//     tell the person to check Buffer and must not try again by itself.
export async function createScheduledPost(input: {
  userId: string
  channelId: string
  text: string
  dueAt: Date
  nowMs?: number
}): Promise<{ postId: string }> {
  return withAccess(
    input.userId,
    input.nowMs ?? Date.now(),
    async ({ token }) => {
      const data = await graphql(
        token,
        `
          mutation CreatePost($input: CreatePostInput!) {
            createPost(input: $input) {
              __typename
              ... on PostActionSuccess {
                post {
                  id
                }
              }
            }
          }
        `,
        {
          input: {
            text: input.text,
            channelId: input.channelId,
            schedulingType: 'automatic',
            mode: 'customScheduled',
            dueAt: input.dueAt.toISOString(),
          },
        },
      )
      const parsed = createData.safeParse(data)
      if (!parsed.success) throw new BufferError('unknown_result')
      const result = parsed.data.createPost
      if (result.__typename === 'PostActionSuccess') {
        if (!result.post) throw new BufferError('unknown_result')
        return { postId: result.post.id }
      }
      if (result.__typename === 'LimitReachedError') {
        throw new BufferError('limit_reached')
      }
      if (result.__typename === 'InvalidInputError') {
        throw new BufferError('invalid')
      }
      if (result.__typename === 'MutationError')
        throw new BufferError('invalid')
      throw new BufferError('unknown_result')
    },
  )
}

const deleteData = z.object({
  deletePost: z.object({ __typename: z.string() }),
})

// Deletes a post that has not been published. 'not_found' means Buffer has no
// such post (already removed); a refusal such as "already published" is
// 'invalid', and the caller then reads the post's status.
export async function deleteScheduledPost(
  userId: string,
  postId: string,
  nowMs = Date.now(),
): Promise<'deleted'> {
  return withAccess(userId, nowMs, async ({ token }) => {
    const data = await graphql(
      token,
      `
        mutation DeletePost($input: DeletePostInput!) {
          deletePost(input: $input) {
            __typename
          }
        }
      `,
      { input: { id: postId } },
    )
    const parsed = deleteData.safeParse(data)
    if (!parsed.success) throw new BufferError('unknown_result')
    if (parsed.data.deletePost.__typename === 'DeletePostSuccess') {
      return 'deleted' as const
    }
    throw new BufferError('invalid')
  })
}

export type PostStatus = 'scheduled' | 'sent' | 'error' | 'other'

const statusData = z.object({
  post: z.object({ status: z.string() }),
})

// The post's state at Buffer: scheduled, sent (published), error, or something
// else the docs do not list.
export async function getPostStatus(
  userId: string,
  postId: string,
  nowMs = Date.now(),
): Promise<PostStatus> {
  return withAccess(userId, nowMs, async ({ token }) => {
    const data = await graphql(
      token,
      `
        query PostStatus($input: PostInput!) {
          post(input: $input) {
            status
          }
        }
      `,
      { input: { id: postId } },
    )
    const parsed = statusData.safeParse(data)
    if (!parsed.success) throw new BufferError('unknown_result')
    const status = parsed.data.post.status.toLowerCase()
    if (status === 'scheduled') return 'scheduled' as const
    if (status === 'sent') return 'sent' as const
    if (status === 'error') return 'error' as const
    return 'other' as const
  })
}
