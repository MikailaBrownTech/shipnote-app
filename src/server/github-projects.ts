import 'server-only'
import { z } from 'zod'
import {
  selectPostCommits,
  sinceDate,
  type CommitSummary,
} from '@/lib/github-commits'
import { isRepoFullName } from '@/lib/github-repo'
import { createClient } from '@/lib/supabase/server'
import {
  createInstallationToken,
  GithubError,
  listInstallationRepos,
  listRecentCommits,
} from './github'
import { getProject, listProjects } from './projects'
import {
  linkProjectRepo,
  removeGithubInstallation,
  unlinkProjectRepo,
} from './supabase-admin'

// The GitHub features on a project: which repositories can be linked, linking
// and unlinking, and the "[post] commits" check. Pages and actions call this.
//
// Nothing here stores a commit, a diff or a token. Tokens are minted per call,
// read-only, and dropped. Commit text is returned only as a short title.

export type Installation = { installationId: number; accountLogin: string }

const installationRow = z.object({
  installation_id: z.number(),
  account_login: z.string(),
})

// The signed-in user's own installations, read with their session so
// row-level security applies. null if they could not be read.
export async function listInstallations(
  userId: string,
): Promise<Installation[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('github_installations')
    .select('installation_id, account_login')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) return null
  const rows = z.array(installationRow).safeParse(data)
  if (!rows.success) return null
  return rows.data.map((row) => ({
    installationId: row.installation_id,
    accountLogin: row.account_login,
  }))
}

// At most this many installations are looked at, so a page cannot fan out.
const MAX_INSTALLATIONS = 5

export type RepoGroup = {
  installationId: number
  accountLogin: string
  repos: string[]
}

export type RepoChoices =
  | { status: 'ok'; groups: RepoGroup[] }
  | { status: 'none' } // no usable installation: connect GitHub first
  | { status: 'error'; kind: 'rate_limited' | 'unavailable' | 'failed' }

function errorKind(error: unknown): 'rate_limited' | 'unavailable' | 'failed' {
  if (error instanceof GithubError) {
    if (error.kind === 'rate_limited') return 'rate_limited'
    if (error.kind === 'unavailable') return 'unavailable'
  }
  return 'failed'
}

// The repositories the user's installations can see, taken from GitHub and not
// from anything the user typed. An installation that no longer exists on
// GitHub is removed here, which makes its projects "need reconnect".
export async function listRepoChoices(userId: string): Promise<RepoChoices> {
  const installations = await listInstallations(userId)
  if (installations === null) return { status: 'error', kind: 'failed' }

  const groups: RepoGroup[] = []
  for (const installation of installations.slice(0, MAX_INSTALLATIONS)) {
    try {
      const token = await createInstallationToken(installation.installationId)
      const repos = await listInstallationRepos(token)
      groups.push({ ...installation, repos })
    } catch (error) {
      if (error instanceof GithubError && error.kind === 'not_installed') {
        await removeGithubInstallation(userId, installation.installationId)
        continue
      }
      return { status: 'error', kind: errorKind(error) }
    }
  }
  return groups.length > 0 ? { status: 'ok', groups } : { status: 'none' }
}

// Which repositories the user's projects are already linked to, by lower-cased
// name (GitHub treats names as case-insensitive), with the project that holds
// each. null if the projects could not be read.
export async function linkedRepos(
  userId: string,
): Promise<Map<string, string> | null> {
  const projects = await listProjects(userId)
  if (!projects.ok) return null
  const linked = new Map<string, string>()
  for (const project of projects.value) {
    if (project.repoFullName) {
      linked.set(project.repoFullName.toLowerCase(), project.id)
    }
  }
  return linked
}

export type LinkResult =
  | 'linked'
  | 'not_in_list' // the repository is not one this installation can see
  | 'no_installation' // not one of the user's installations
  | 'not_found' // no such project of theirs
  | 'already_linked' // another of the user's projects already uses this repository
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

// Links a project to a repository, but only if the repository is on the
// installation's list as GitHub reports it now, and the installation is the
// user's own.
export async function linkRepo(input: {
  userId: string
  projectId: string
  installationId: number
  repoFullName: string
}): Promise<LinkResult> {
  if (!isRepoFullName(input.repoFullName)) return 'not_in_list'

  const installations = await listInstallations(input.userId)
  if (installations === null) return 'failed'
  if (!installations.some((i) => i.installationId === input.installationId)) {
    return 'no_installation'
  }

  const project = await getProject(input.userId, input.projectId)
  if (!project.ok) {
    return project.reason === 'not_found' ? 'not_found' : 'failed'
  }

  // The same repository cannot be linked to two of the user's projects (the
  // database enforces it too). Linking a project to its own repository again
  // is fine.
  const linked = await linkedRepos(input.userId)
  if (linked === null) return 'failed'
  const holder = linked.get(input.repoFullName.toLowerCase())
  if (holder !== undefined && holder !== input.projectId) {
    return 'already_linked'
  }

  let repos: string[]
  try {
    const token = await createInstallationToken(input.installationId)
    repos = await listInstallationRepos(token)
  } catch (error) {
    if (error instanceof GithubError && error.kind === 'not_installed') {
      await removeGithubInstallation(input.userId, input.installationId)
      return 'no_installation'
    }
    return errorKind(error)
  }
  if (!repos.includes(input.repoFullName)) return 'not_in_list'

  return (await linkProjectRepo(input)) ? 'linked' : 'failed'
}

export async function unlinkRepo(
  userId: string,
  projectId: string,
): Promise<'unlinked' | 'not_found' | 'failed'> {
  const project = await getProject(userId, projectId)
  if (!project.ok) {
    return project.reason === 'not_found' ? 'not_found' : 'failed'
  }
  return (await unlinkProjectRepo(userId, projectId)) ? 'unlinked' : 'failed'
}

export type CommitCheck =
  | { status: 'ok'; repo: string; commits: CommitSummary[] }
  | { status: 'not_found' } // no such project of theirs
  | { status: 'not_linked' }
  | { status: 'reconnect' } // the installation is gone
  | { status: 'repo_gone' } // the repository is gone or no longer visible
  | { status: 'rate_limited' }
  | { status: 'unavailable' }
  | { status: 'failed' }

// Fetches the last 30 days of commits for the project's repository with a
// read-only token limited to that one repository, and returns up to 20 whose
// message contains [post]. Nothing is stored.
export async function checkPostCommits(
  userId: string,
  projectId: string,
  nowMs: number = Date.now(),
): Promise<CommitCheck> {
  const project = await getProject(userId, projectId)
  if (!project.ok) {
    return project.reason === 'not_found'
      ? { status: 'not_found' }
      : { status: 'failed' }
  }
  const { repoFullName, installationId } = project.value
  if (!repoFullName) return { status: 'not_linked' }
  if (installationId === null) return { status: 'reconnect' }

  try {
    const token = await createInstallationToken(installationId, repoFullName)
    const raw = await listRecentCommits(token, repoFullName, sinceDate(nowMs))
    return {
      status: 'ok',
      repo: repoFullName,
      commits: selectPostCommits(raw, repoFullName),
    }
  } catch (error) {
    if (error instanceof GithubError) {
      if (error.kind === 'not_installed') {
        // The App was uninstalled or suspended. Forget the installation; the
        // project keeps its repository name and shows "Reconnect GitHub".
        await removeGithubInstallation(userId, installationId)
        return { status: 'reconnect' }
      }
      if (error.kind === 'not_found') return { status: 'repo_gone' }
      if (error.kind === 'rate_limited') return { status: 'rate_limited' }
      if (error.kind === 'unavailable') return { status: 'unavailable' }
    }
    return { status: 'failed' }
  }
}

// Removes the user's own installation row. It does not uninstall the App on
// GitHub.
export function disconnectGithub(
  userId: string,
  installationId: number,
): Promise<boolean> {
  return removeGithubInstallation(userId, installationId)
}
