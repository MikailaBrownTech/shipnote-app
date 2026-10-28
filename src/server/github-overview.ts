import 'server-only'
import { z } from 'zod'
import type { RepoItem } from '@/lib/github-view'
import { createClient } from '@/lib/supabase/server'
import {
  createInstallationToken,
  GithubError,
  listInstallationRepoInfo,
} from './github'
import { listProjects } from './projects'
import { removeGithubInstallation } from './supabase-admin'

// Everything the GitHub page shows about the user's connection: which GitHub
// accounts are connected, and the repositories each can see with the details
// GitHub gives for them. Read live from GitHub with read-only installation
// tokens that are minted per call and dropped. Nothing here stores or logs
// anything from GitHub, and the user comes from our own database, never from
// the request.

export type GithubAccount = {
  installationId: number
  login: string
  connectedAt: string | null
}

export type OverviewRepo = RepoItem & {
  installationId: number
  // The user's project this repository is linked to, if any.
  projectId: string | null
}

export type GithubOverview =
  | { status: 'none' } // no usable connection: connect GitHub first
  | {
      status: 'ok'
      accounts: GithubAccount[]
      repos: OverviewRepo[]
      // When GitHub was read, in milliseconds.
      readAt: number
    }
  | { status: 'error'; kind: 'rate_limited' | 'unavailable' | 'failed' }

// At most this many installations are looked at, so a page cannot fan out.
const MAX_INSTALLATIONS = 5

const installationRow = z.object({
  installation_id: z.number(),
  account_login: z.string(),
  created_at: z.string().nullable(),
})

function errorKind(error: unknown): 'rate_limited' | 'unavailable' | 'failed' {
  if (error instanceof GithubError) {
    if (error.kind === 'rate_limited') return 'rate_limited'
    if (error.kind === 'unavailable') return 'unavailable'
  }
  return 'failed'
}

export async function loadGithubOverview(
  userId: string,
): Promise<GithubOverview> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('github_installations')
    .select('installation_id, account_login, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) return { status: 'error', kind: 'failed' }
  const rows = z.array(installationRow).safeParse(data)
  if (!rows.success) return { status: 'error', kind: 'failed' }
  if (rows.data.length === 0) return { status: 'none' }

  // Which repositories already belong to one of the user's projects.
  const projects = await listProjects(userId)
  const linked = new Map<string, string>()
  if (projects.ok) {
    for (const project of projects.value) {
      if (project.repoFullName) {
        linked.set(project.repoFullName.toLowerCase(), project.id)
      }
    }
  }

  const accounts: GithubAccount[] = []
  const repos: OverviewRepo[] = []
  for (const row of rows.data.slice(0, MAX_INSTALLATIONS)) {
    try {
      const token = await createInstallationToken(row.installation_id)
      const infos = await listInstallationRepoInfo(token)
      accounts.push({
        installationId: row.installation_id,
        login: row.account_login,
        connectedAt: row.created_at,
      })
      for (const info of infos) {
        repos.push({
          ...info,
          installationId: row.installation_id,
          projectId: linked.get(info.fullName.toLowerCase()) ?? null,
        })
      }
    } catch (failure) {
      // The App was uninstalled or suspended on GitHub: forget the connection
      // here too, as the project pages do.
      if (failure instanceof GithubError && failure.kind === 'not_installed') {
        await removeGithubInstallation(userId, row.installation_id)
        continue
      }
      return { status: 'error', kind: errorKind(failure) }
    }
  }
  return accounts.length > 0
    ? { status: 'ok', accounts, repos, readAt: Date.now() }
    : { status: 'none' }
}
