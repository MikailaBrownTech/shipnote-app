import 'server-only'
import {
  exchangeUserCode,
  getUser,
  GithubError,
  listUserInstallations,
  revokeUserToken,
  type UserInstallation,
} from './github'

// Decides whether the person who just came back from GitHub really owns the
// installation they are connecting. The installation_id in the URL is only a
// hint and is never trusted: it can be forged, so ownership comes from GitHub
// itself. The user token used for that is revoked before this returns and is
// never stored.

export type VerifyFailure =
  'invalid' | 'denied' | 'org' | 'unavailable' | 'rate_limited' | 'failed'

export type VerifyResult =
  | {
      ok: true
      installation: {
        installationId: number
        accountLogin: string
        accountId: number
      }
    }
  | { ok: false; reason: VerifyFailure }

function reasonFor(error: unknown): VerifyFailure {
  if (!(error instanceof GithubError)) return 'failed'
  if (error.kind === 'unavailable') return 'unavailable'
  if (error.kind === 'rate_limited') return 'rate_limited'
  if (error.kind === 'denied') return 'denied'
  return 'failed'
}

export async function verifyInstallation(input: {
  code: string
  // From the URL. Optional, and only a hint.
  claimedInstallationId: number | null
}): Promise<VerifyResult> {
  let userToken: string
  try {
    userToken = await exchangeUserCode(input.code)
  } catch (error) {
    return { ok: false, reason: reasonFor(error) }
  }

  try {
    const me = await getUser(userToken)
    const installations = await listUserInstallations(userToken)

    let chosen: UserInstallation | null = null
    if (input.claimedInstallationId !== null) {
      // The claimed id must be one of this user's installations.
      chosen =
        installations.find((item) => item.id === input.claimedInstallationId) ??
        null
      if (!chosen) return { ok: false, reason: 'invalid' }
    } else {
      // No id in the URL. A person has at most one installation of the App on
      // their own account, so there is only one candidate.
      const own = installations.filter(
        (item) => item.account.type === 'User' && item.account.id === me.id,
      )
      if (own.length === 1) chosen = own[0] ?? null
      if (!chosen) {
        return {
          ok: false,
          reason: installations.length > 0 ? 'org' : 'invalid',
        }
      }
    }

    // Personal accounts only, and only the person's own account.
    if (chosen.account.type !== 'User') return { ok: false, reason: 'org' }
    if (chosen.account.id !== me.id) return { ok: false, reason: 'invalid' }

    return {
      ok: true,
      installation: {
        installationId: chosen.id,
        accountLogin: chosen.account.login,
        accountId: chosen.account.id,
      },
    }
  } catch (error) {
    return { ok: false, reason: reasonFor(error) }
  } finally {
    // Discard the user token whatever happened.
    await revokeUserToken(userToken)
  }
}
