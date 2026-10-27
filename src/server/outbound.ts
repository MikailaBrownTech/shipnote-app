import 'server-only'

// The only way server code makes an outbound HTTP request. It refuses any
// host that is not listed here, so a bug (or untrusted data that ends up in a
// URL) cannot make the server call somewhere else.
//
// To allow a new host, add it to RULES and nowhere else.
const RULES: Record<string, { paths?: readonly string[] }> = {
  // Sign-in alert emails.
  'api.resend.com': {},
  // The GitHub REST API.
  'api.github.com': {},
  // Draft generation. Only the Messages endpoint.
  'api.anthropic.com': { paths: ['/v1/messages'] },
  // Scheduling through the user's own Buffer account: the GraphQL API (one
  // endpoint) and the OAuth token endpoint (code exchange and refresh). The
  // authorization page is a browser redirect, not a server call.
  'api.buffer.com': { paths: ['/'] },
  'auth.buffer.com': { paths: ['/token'] },
  // GitHub's OAuth token exchange lives on github.com, not api.github.com.
  // Only that one path is allowed there.
  'github.com': { paths: ['/login/oauth/access_token'] },
}

// Deliberately says nothing about the URL: it can hold tokens or user data.
export class OutboundRefusedError extends Error {
  constructor() {
    super('Outbound request refused')
    this.name = 'OutboundRefusedError'
  }
}

type Init = RequestInit & { timeoutMs?: number }

export function isAllowedUrl(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password || url.port) return false
  if (!Object.hasOwn(RULES, url.hostname)) return false
  const { paths } = RULES[url.hostname] ?? {}
  return paths === undefined || paths.includes(url.pathname)
}

export function outboundFetch(
  input: string,
  { timeoutMs = 5000, ...init }: Init = {},
): Promise<Response> {
  if (!isAllowedUrl(input)) return Promise.reject(new OutboundRefusedError())
  return fetch(new URL(input).href, {
    ...init,
    // A redirect could lead to a host that is not allowed. GitHub and Resend
    // do not redirect these calls, so treat one as a failure.
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
}
