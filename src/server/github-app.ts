import 'server-only'
import { getGithubEnv, githubEnabled } from './env'
import {
  removeGithubInstallation,
  saveGithubInstallation,
  type SaveInstallationResult,
} from './supabase-admin'

// What pages, actions and the callback use for the GitHub feature. They call
// this, not the lower-level env, GitHub client or service-role modules.

export function githubIsEnabled(): boolean {
  return githubEnabled()
}

// The App's installation page on github.com, built from the slug in the
// environment (checked against a strict pattern there), never from a request.
// null while the feature is off.
export function installUrl(nonce: string): string | null {
  const settings = getGithubEnv()
  if (!settings) return null
  return `https://github.com/apps/${encodeURIComponent(settings.slug)}/installations/new?state=${encodeURIComponent(nonce)}`
}

// Called only after verifyInstallation() confirmed the installation is the
// signed-in user's.
export function saveVerifiedInstallation(input: {
  userId: string
  installationId: number
  accountLogin: string
  accountId: number
}): Promise<SaveInstallationResult> {
  return saveGithubInstallation(input)
}

export function disconnectInstallation(
  userId: string,
  installationId: number,
): Promise<boolean> {
  return removeGithubInstallation(userId, installationId)
}
