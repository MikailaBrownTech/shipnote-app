import 'server-only'
import { isRepoFullName } from '@/lib/github-repo'
import { buildPrefill, type Prefill } from '@/lib/repo-prefill'
import {
  createInstallationToken,
  fetchReadme,
  GithubError,
  listInstallationRepoInfo,
  type RepoInfo,
} from './github'
import { linkedRepos, listInstallations } from './github-projects'
import { linkProjectRepo, removeGithubInstallation } from './supabase-admin'

// "Start from a GitHub repo": which repositories can be offered, and the values
// the new-project form is filled with when one is picked.
//
// Nothing here saves a project, and nothing stores a token, a README or any
// GitHub response. Tokens are minted per call, read-only, and dropped. The one
// file read is the README, through GitHub's README endpoint, and it is returned
// to the caller as untrusted text.

// At most this many installations are looked at, so a page cannot fan out.
const MAX_INSTALLATIONS = 5

export type StartGroup = {
  installationId: number
  accountLogin: string
  repos: { fullName: string }[]
}

export type StartChoices =
  | { status: 'ok'; groups: StartGroup[] }
  | { status: 'none' } // no usable installation, or nothing left to start from
  | { status: 'error'; kind: 'rate_limited' | 'unavailable' | 'failed' }

function errorKind(error: unknown): 'rate_limited' | 'unavailable' | 'failed' {
  if (error instanceof GithubError) {
    if (error.kind === 'rate_limited') return 'rate_limited'
    if (error.kind === 'unavailable') return 'unavailable'
  }
  return 'failed'
}

// The repositories the user's installations can see, from GitHub, minus the
// ones already linked to one of the user's projects.
export async function listStartRepos(userId: string): Promise<StartChoices> {
  const installations = await listInstallations(userId)
  const linked = await linkedRepos(userId)
  if (installations === null || linked === null) {
    return { status: 'error', kind: 'failed' }
  }

  const groups: StartGroup[] = []
  for (const installation of installations.slice(0, MAX_INSTALLATIONS)) {
    try {
      const token = await createInstallationToken(installation.installationId)
      const repos = await listInstallationRepoInfo(token)
      groups.push({
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        repos: repos
          .filter((repo) => !linked.has(repo.fullName.toLowerCase()))
          .map((repo) => ({ fullName: repo.fullName })),
      })
    } catch (error) {
      if (error instanceof GithubError && error.kind === 'not_installed') {
        await removeGithubInstallation(userId, installation.installationId)
        continue
      }
      return { status: 'error', kind: errorKind(error) }
    }
  }

  const usable = groups.filter((group) => group.repos.length > 0)
  return usable.length > 0
    ? { status: 'ok', groups: usable }
    : { status: 'none' }
}

export type RepoCheckFailure =
  | 'not_in_list' // the repository is not one this installation can see
  | 'already_linked' // another of the user's projects already uses it
  | 'no_installation' // not one of the user's installations
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

type Checked =
  | { ok: true; repo: RepoInfo; installationId: number }
  | { ok: false; reason: RepoCheckFailure }

// The checks that come before anything about the repository is fetched:
// the installation is the user's, the repository is not already linked, and the
// repository is on that installation's list as GitHub reports it now.
async function checkRepo(input: {
  userId: string
  installationId: number
  repoFullName: string
}): Promise<Checked> {
  if (!isRepoFullName(input.repoFullName)) {
    return { ok: false, reason: 'not_in_list' }
  }

  const installations = await listInstallations(input.userId)
  if (installations === null) return { ok: false, reason: 'failed' }
  if (!installations.some((i) => i.installationId === input.installationId)) {
    return { ok: false, reason: 'no_installation' }
  }

  const linked = await linkedRepos(input.userId)
  if (linked === null) return { ok: false, reason: 'failed' }
  if (linked.has(input.repoFullName.toLowerCase())) {
    return { ok: false, reason: 'already_linked' }
  }

  let repos: RepoInfo[]
  try {
    const token = await createInstallationToken(input.installationId)
    repos = await listInstallationRepoInfo(token)
  } catch (error) {
    if (error instanceof GithubError && error.kind === 'not_installed') {
      await removeGithubInstallation(input.userId, input.installationId)
      return { ok: false, reason: 'no_installation' }
    }
    return { ok: false, reason: errorKind(error) }
  }

  // Exact match on the name GitHub returned: a lookalike is not on the list.
  const repo = repos.find((item) => item.fullName === input.repoFullName)
  if (!repo) return { ok: false, reason: 'not_in_list' }
  return { ok: true, repo, installationId: input.installationId }
}

export type VerifiedRepo =
  | { status: 'ok'; installationId: number; repoFullName: string }
  | { status: RepoCheckFailure }

// Used when a project is saved with a repository: confirms again, now, that the
// repository may be linked. Fetches nothing about it.
export async function verifyRepoForLink(input: {
  userId: string
  installationId: number
  repoFullName: string
}): Promise<VerifiedRepo> {
  const checked = await checkRepo(input)
  if (!checked.ok) return { status: checked.reason }
  return {
    status: 'ok',
    installationId: checked.installationId,
    // The spelling GitHub uses.
    repoFullName: checked.repo.fullName,
  }
}

export type PrefillResult =
  | {
      status: 'ok'
      prefill: Prefill
      link: { installationId: number; repoFullName: string }
    }
  | { status: RepoCheckFailure }

// What to fill the new-project form with for one repository. Validates the
// choice against the installation's list first, then reads the README with a
// token limited to that one repository. Saves nothing.
export async function prefillFromRepo(input: {
  userId: string
  installationId: number
  repoFullName: string
}): Promise<PrefillResult> {
  const checked = await checkRepo(input)
  if (!checked.ok) return { status: checked.reason }
  const { repo } = checked

  try {
    const token = await createInstallationToken(
      checked.installationId,
      repo.fullName,
    )
    const readme = await fetchReadme(token, repo.fullName)
    return {
      status: 'ok',
      prefill: buildPrefill({
        repoName: repo.name,
        description: repo.description,
        readme: readme.found ? readme.text : null,
        readmeCut: readme.found && readme.cut,
      }),
      link: {
        installationId: checked.installationId,
        repoFullName: repo.fullName,
      },
    }
  } catch (error) {
    if (error instanceof GithubError) {
      if (error.kind === 'not_installed') {
        await removeGithubInstallation(input.userId, checked.installationId)
        return { status: 'no_installation' }
      }
      // The repository left the installation between the two calls.
      if (error.kind === 'not_found') return { status: 'not_in_list' }
    }
    return { status: errorKind(error) }
  }
}

// Links a project that was just created to the repository that was verified for
// it. false if the database refused (for example, the repository was linked by
// another request in the meantime).
export function linkCreatedProject(input: {
  userId: string
  projectId: string
  installationId: number
  repoFullName: string
}): Promise<boolean> {
  return linkProjectRepo(input)
}
