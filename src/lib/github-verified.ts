// Backstop for the before-user-created hook. The hook is the real gate; this
// re-checks a GitHub sign-in in the callback in case the hook was misconfigured
// or GitHub's payload differs from what the hook expects. Best effort,
// unproven against real GitHub payloads (see the README).

type Identity = {
  provider?: string
  last_sign_in_at?: string
  identity_data?: Record<string, unknown>
}

export type CallbackUser = {
  created_at?: string
  user_metadata?: Record<string, unknown>
  identities?: Identity[]
}

export type GithubCheck =
  | 'not-github' // this sign-in was not through GitHub
  | 'ok'
  | 'deny' // sign the person out
  | 'deny-and-delete' // sign out and remove a brand-new account

const RECENT_MS = 2 * 60 * 1000

function within(iso: string | undefined, nowMs: number) {
  const time = iso ? Date.parse(iso) : NaN
  return !Number.isNaN(time) && Math.abs(nowMs - time) <= RECENT_MS
}

export function checkGithubSignIn(
  user: CallbackUser,
  nowMs: number,
): GithubCheck {
  const identities = user.identities ?? []
  const github = identities.find((identity) => identity.provider === 'github')
  if (!github || !within(github.last_sign_in_at, nowMs)) return 'not-github'

  // Explicit true only. The identity's own flag wins when it is present; the
  // user-level flag is the fallback when the identity has none.
  const own = github.identity_data?.email_verified
  const verified =
    own === true ||
    (own === undefined && user.user_metadata?.email_verified === true)
  if (verified) return 'ok'

  // Only remove an account that was just created through this sign-in. A
  // long-standing account is never deleted because of a flag.
  const brandNew = within(user.created_at, nowMs) && identities.length === 1
  return brandNew ? 'deny-and-delete' : 'deny'
}
