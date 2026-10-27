import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { autoDraftsEnabled, getAutoDraftsEnv } from './env'

// Automatic drafts: what pages and the two public doors may ask. Reads and the
// switch go through the signed-in user's own session, so row-level security
// applies. Nothing here logs a value; failures are plain results.

// Whether the feature is on (the kill switch). Only reads the flag.
export function autoDraftsOn(): boolean {
  return autoDraftsEnabled()
}

// The secrets the doors verify with. null while the feature is off. Throws,
// naming the variable, if it is on and something is missing.
export function autoDraftsConfig() {
  return getAutoDraftsEnv()
}

function note(code: string | undefined) {
  console.warn('auto drafts: query failed', code ?? 'unknown')
}

// Turns the switch on or off for one of the user's own projects.
export async function setAutoDraft(
  userId: string,
  projectId: string,
  on: boolean,
): Promise<'ok' | 'not_found' | 'failed'> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update({ auto_draft: on })
    .eq('id', projectId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    note(error.code)
    return 'failed'
  }
  return (data as unknown[]).length > 0 ? 'ok' : 'not_found'
}

// Whether the switch is on for the user's own project. null if not readable.
export async function readAutoDraft(
  userId: string,
  projectId: string,
): Promise<boolean | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('auto_draft')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    note(error.code)
    return null
  }
  const row = z.object({ auto_draft: z.boolean() }).safeParse(data)
  return row.success ? row.data.auto_draft : null
}

export type AutoJob = {
  id: string
  commitSha: string
  status: 'queued' | 'running' | 'done' | 'skipped' | 'failed'
  reason: string | null
  draftId: string | null
  createdAt: string
}

const jobRow = z.object({
  id: z.string(),
  commit_sha: z.string(),
  status: z.enum(['queued', 'running', 'done', 'skipped', 'failed']),
  reason: z.string().nullable(),
  draft_id: z.string().nullable(),
  created_at: z.string(),
})

// The project's newest jobs, for the Drafts tab. null if they could not be read.
export async function listAutoJobs(
  userId: string,
  projectId: string,
  limit = 20,
): Promise<AutoJob[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('auto_draft_jobs')
    .select('id, commit_sha, status, reason, draft_id, created_at')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    note(error.code)
    return null
  }
  const rows = z.array(jobRow).safeParse(data)
  if (!rows.success) return null
  return rows.data.map((row) => ({
    id: row.id,
    commitSha: row.commit_sha,
    status: row.status,
    reason: row.reason,
    draftId: row.draft_id,
    createdAt: row.created_at,
  }))
}
