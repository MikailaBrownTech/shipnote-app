import 'server-only'
import { createSign } from 'node:crypto'
import { z } from 'zod'
import { isRepoFullName, splitRepo } from '@/lib/github-repo'
import { getGithubEnv } from './env'
import { outboundFetch } from './outbound'

// The only module that talks to GitHub. Every request goes through
// outboundFetch (so the host allowlist applies), and nothing here logs or
// returns a token, a commit message or a response body: errors carry only a
// fixed kind.

export type GithubFailure =
  | 'denied' // 401, or a 403 that is not a rate limit
  | 'not_installed' // the installation is gone, suspended or never existed
  | 'not_found' // the repository is gone or not visible to the installation
  | 'rate_limited'
  | 'unavailable' // GitHub is down, slow or unreachable
  | 'unprocessable' // 422: for a token request, the repository is not on the installation
  | 'failed'

export class GithubError extends Error {
  readonly kind: GithubFailure
  constructor(kind: GithubFailure) {
    super(`GitHub request failed: ${kind}`)
    this.name = 'GithubError'
    this.kind = kind
  }
}

const API = 'https://api.github.com'
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token'

function config() {
  const settings = getGithubEnv()
  if (!settings) throw new Error('GitHub is not enabled')
  return settings
}

const apiHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  // GitHub rejects requests without a User-Agent.
  'User-Agent': 'shipnote',
}

function failureFor(response: Response): GithubFailure {
  const { status, headers } = response
  if (status === 404) return 'not_found'
  if (status === 401) return 'denied'
  if (status === 429) return 'rate_limited'
  if (status === 422) return 'unprocessable'
  if (status === 403) {
    // Primary limit: remaining is 0. Secondary limit: retry-after is set.
    return headers.get('x-ratelimit-remaining') === '0' ||
      headers.has('retry-after')
      ? 'rate_limited'
      : 'denied'
  }
  if (status >= 500) return 'unavailable'
  return 'failed'
}

async function send(
  url: string,
  init: RequestInit,
  okStatuses: readonly number[] = [],
): Promise<Response> {
  let response: Response
  try {
    response = await outboundFetch(url, { timeoutMs: 8000, ...init })
  } catch {
    // Network failure, timeout, refused host or redirect. Nothing about the
    // request goes into the error.
    throw new GithubError('unavailable')
  }
  if (!response.ok && !okStatuses.includes(response.status)) {
    throw new GithubError(failureFor(response))
  }
  return response
}

async function json<S extends z.ZodType>(
  response: Response,
  schema: S,
): Promise<z.infer<S>> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GithubError('failed')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new GithubError('failed')
  return parsed.data
}

const b64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url')

// A short-lived JWT that proves we are the App (RS256, at most 10 minutes).
// Built with Node's crypto, so no JWT library is needed and the signing key
// never leaves this process. iat is backdated 60 seconds for clock drift, as
// GitHub's docs advise.
export function createAppJwt(
  appId: string,
  privateKeyPem: string,
  nowMs: number = Date.now(),
): string {
  const now = Math.floor(nowMs / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }),
  )}`
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(privateKeyPem)
  return `${unsigned}.${b64url(signature)}`
}

// ---- Acting for a user (only during the connect flow) ----

// Trades the one-time code from GitHub's redirect for a user token. The token
// is used for two read calls and then revoked. It is never stored.
export async function exchangeUserCode(code: string): Promise<string> {
  const { clientId, clientSecret } = config()
  const response = await send(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  })
  // A bad or reused code can come back as 200 with an "error" field.
  const body = await json(
    response,
    z.object({ access_token: z.string().min(1).optional() }),
  )
  if (!body.access_token) throw new GithubError('denied')
  return body.access_token
}

const userSchema = z.object({ id: z.number().int(), login: z.string() })

export async function getUser(userToken: string) {
  const response = await send(`${API}/user`, {
    headers: { ...apiHeaders, Authorization: `Bearer ${userToken}` },
  })
  return json(response, userSchema)
}

const installationsSchema = z.object({
  installations: z.array(
    z.object({
      id: z.number().int(),
      account: z.object({
        id: z.number().int(),
        login: z.string(),
        type: z.string(),
      }),
    }),
  ),
})

export type UserInstallation = {
  id: number
  account: { id: number; login: string; type: string }
}

// The installations of this App that this GitHub user has access to.
export async function listUserInstallations(
  userToken: string,
): Promise<UserInstallation[]> {
  const found: UserInstallation[] = []
  for (let page = 1; page <= 3; page += 1) {
    const response = await send(
      `${API}/user/installations?per_page=100&page=${String(page)}`,
      { headers: { ...apiHeaders, Authorization: `Bearer ${userToken}` } },
    )
    const body = await json(response, installationsSchema)
    found.push(...body.installations)
    if (body.installations.length < 100) break
  }
  return found
}

// Best effort: tell GitHub the user token is no longer needed. Never throws,
// and never reports why it failed.
export async function revokeUserToken(userToken: string): Promise<boolean> {
  try {
    const { clientId, clientSecret } = config()
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    await send(`${API}/applications/${encodeURIComponent(clientId)}/token`, {
      method: 'DELETE',
      headers: {
        ...apiHeaders,
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: userToken }),
    })
    return true
  } catch {
    return false
  }
}

// ---- Acting as the installation (per request, never stored) ----

const tokenSchema = z.object({ token: z.string().min(1) })

// Mints a read-only installation token. With `repo` it is limited to that one
// repository and to Contents + Metadata read; without it, to Metadata read
// across the installation (enough to list the repositories). It expires after
// an hour and is not stored: callers use it and let it go.
export async function createInstallationToken(
  installationId: number,
  repo?: string,
): Promise<string> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new GithubError('not_installed')
  }
  const { appId, privateKeyPem } = config()
  const jwt = createAppJwt(appId, privateKeyPem)
  const body = repo
    ? {
        repositories: [splitRepo(repo).repo],
        permissions: { contents: 'read', metadata: 'read' },
      }
    : { permissions: { metadata: 'read' } }

  let response: Response
  try {
    response = await send(
      `${API}/app/installations/${String(installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          ...apiHeaders,
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )
  } catch (error) {
    if (error instanceof GithubError) {
      // 404: the installation is gone. 403: suspended. 422: the repository is
      // not on this installation any more.
      if (error.kind === 'not_found' || error.kind === 'denied') {
        throw new GithubError('not_installed')
      }
      // 422: the repository is no longer on this installation.
      if (error.kind === 'unprocessable') throw new GithubError('not_found')
    }
    throw error
  }
  return (await json(response, tokenSchema)).token
}

const reposSchema = z.object({
  repositories: z.array(
    z.object({
      full_name: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      // Repository details GitHub returns in the same answer (Metadata
      // permission). All optional: a missing one is shown as unknown.
      private: z.boolean().optional(),
      language: z.string().nullable().optional(),
      stargazers_count: z.number().int().nonnegative().optional(),
      forks_count: z.number().int().nonnegative().optional(),
      open_issues_count: z.number().int().nonnegative().optional(),
      pushed_at: z.string().nullable().optional(),
      updated_at: z.string().nullable().optional(),
    }),
  ),
})

export type RepoInfo = {
  fullName: string
  name: string
  // GitHub's own one-line description, or null.
  description: string | null
  isPrivate: boolean
  // The main language GitHub reports, or null.
  language: string | null
  stars: number
  forks: number
  openIssues: number
  // When the repository was last pushed to (or changed), or null.
  updatedAt: string | null
}

// The repositories this installation can see, with the name and description
// GitHub gives for each. Only well-formed names are kept.
export async function listInstallationRepoInfo(
  installationToken: string,
): Promise<RepoInfo[]> {
  const found: RepoInfo[] = []
  for (let page = 1; page <= 5; page += 1) {
    const response = await send(
      `${API}/installation/repositories?per_page=100&page=${String(page)}`,
      {
        headers: {
          ...apiHeaders,
          Authorization: `Bearer ${installationToken}`,
        },
      },
    )
    const body = await json(response, reposSchema)
    for (const repo of body.repositories) {
      if (!isRepoFullName(repo.full_name)) continue
      found.push({
        fullName: repo.full_name,
        name: repo.name ?? splitRepo(repo.full_name).repo,
        description: repo.description ?? null,
        isPrivate: repo.private ?? false,
        language: repo.language ?? null,
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        openIssues: repo.open_issues_count ?? 0,
        updatedAt: repo.pushed_at ?? repo.updated_at ?? null,
      })
    }
    if (body.repositories.length < 100) break
  }
  return found
}

// Just the names, for the places that only need to know which repositories
// exist.
export async function listInstallationRepos(
  installationToken: string,
): Promise<string[]> {
  return (await listInstallationRepoInfo(installationToken)).map(
    (repo) => repo.fullName,
  )
}

// At most this much of a README is read, whatever its size. It is far more than
// the 12,000 characters the notes can hold.
export const README_MAX_BYTES = 256 * 1024

export type ReadmeResult =
  | { found: false }
  // cut is true when the README was longer than what was read.
  | { found: true; text: string; cut: boolean }

// Reads at most `max` bytes of a response body. A partial character at the cut
// is dropped, not turned into a replacement character.
async function readCapped(
  response: Response,
  max: number,
): Promise<{ text: string; cut: boolean }> {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  if (!response.body)
    return { text: decoder.decode(await response.arrayBuffer()), cut: false }

  const reader = response.body.getReader()
  let text = ''
  let read = 0
  let cut = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = max - read
    if (value.byteLength > room) {
      text += decoder.decode(value.subarray(0, room), { stream: true })
      cut = true
      await reader.cancel()
      break
    }
    read += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  // Without cut, flush; with cut, the incomplete tail is left out on purpose.
  if (!cut) text += decoder.decode()
  return { text, cut }
}

// The repository's README, as plain text, through GitHub's README endpoint
// (GET /repos/{owner}/{repo}/readme) and nothing else: no other file, no diff,
// no file list. The token should be the one limited to this repository. The
// text is untrusted. It is returned to the caller and not stored, logged or
// put in an error here.
export async function fetchReadme(
  installationToken: string,
  fullName: string,
): Promise<ReadmeResult> {
  if (!isRepoFullName(fullName)) throw new GithubError('not_found')
  const { owner, repo } = splitRepo(fullName)
  const response = await send(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    {
      headers: {
        ...apiHeaders,
        // The file as it is, not JSON with base64 inside.
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${installationToken}`,
      },
    },
    [404],
  )
  // No README is not an error.
  if (response.status === 404) return { found: false }
  try {
    const { text, cut } = await readCapped(response, README_MAX_BYTES)
    return { found: true, text, cut }
  } catch {
    throw new GithubError('unavailable')
  }
}

const commitsSchema = z.array(
  z.object({
    sha: z.string(),
    commit: z.object({
      message: z.string(),
      author: z.object({ date: z.string() }).nullable().optional(),
    }),
  }),
)

export type RawCommit = { sha: string; message: string; date: string | null }

// Recent commits on the default branch. Only the sha, message and author date
// are kept: no diffs, no file lists, nothing else from the response.
export async function listRecentCommits(
  installationToken: string,
  fullName: string,
  sinceIso: string,
): Promise<RawCommit[]> {
  if (!isRepoFullName(fullName)) throw new GithubError('not_found')
  const { owner, repo } = splitRepo(fullName)
  // 409 is what GitHub answers for an empty repository: no commits.
  const response = await send(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`,
    {
      headers: { ...apiHeaders, Authorization: `Bearer ${installationToken}` },
    },
    [409],
  )
  if (response.status === 409) return []
  const body = await json(response, commitsSchema)
  return body.map((item) => ({
    sha: item.sha,
    message: item.commit.message,
    date: item.commit.author?.date ?? null,
  }))
}

const oneCommitSchema = z.object({
  sha: z.string(),
  commit: z.object({ message: z.string() }),
  parents: z.array(z.object({ sha: z.string() })),
})

export type OneCommit = { sha: string; message: string; parentCount: number }

// One commit by its full sha, for the repository the token is limited to. Only
// the sha, the message and how many parents it has are kept (a merge commit has
// more than one): no diff, no file list, nothing else from the response.
export async function getCommit(
  installationToken: string,
  fullName: string,
  sha: string,
): Promise<OneCommit> {
  if (!isRepoFullName(fullName) || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new GithubError('not_found')
  }
  const { owner, repo } = splitRepo(fullName)
  let response: Response
  try {
    response = await send(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${sha}`,
      {
        headers: {
          ...apiHeaders,
          Authorization: `Bearer ${installationToken}`,
        },
      },
    )
  } catch (error) {
    // 422 is what GitHub answers for a sha it does not know.
    if (error instanceof GithubError && error.kind === 'unprocessable') {
      throw new GithubError('not_found')
    }
    throw error
  }
  const body = await json(response, oneCommitSchema)
  return {
    sha: body.sha.toLowerCase(),
    message: body.commit.message,
    parentCount: body.parents.length,
  }
}
