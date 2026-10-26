// When did the user last actually sign in? A refreshed access token has a new
// `iat`, so that is no use. The `amr` claim lists how the session was
// authenticated, with a timestamp for each method; refreshes are marked
// 'token_refresh' and are ignored here.
//
// Unproven against a real refreshed token (see the README). If no usable
// entry exists this returns null, and callers treat that as "not recent".
export function lastSignInAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null
  let latest: number | null = null
  for (const entry of amr as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { method, timestamp } = entry as Record<string, unknown>
    if (method === 'token_refresh' || typeof timestamp !== 'number') continue
    if (latest === null || timestamp > latest) latest = timestamp
  }
  return latest
}

export function signedInWithin(
  signedInAt: number | null,
  seconds: number,
  nowMs: number,
): boolean {
  if (signedInAt === null) return false
  const age = nowMs / 1000 - signedInAt
  return age >= -60 && age <= seconds
}
