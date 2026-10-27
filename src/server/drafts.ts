import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// A user's own drafts, read and changed with their own session, so row-level
// security applies. Drafts are created only by the generation function in
// Postgres (see draft-generation.ts). Nothing here logs or returns anything but
// the draft fields, and failures are plain results.

export type Draft = {
  id: string
  projectId: string
  body: string
  status: 'draft' | 'copied'
  model: string
  createdAt: string
  copiedAt: string | null
  // Full commit shas the draft was written from.
  shas: string[]
}

const COLUMNS = 'id, project_id, body, status, model, created_at, copied_at'

const row = z.object({
  id: z.string(),
  project_id: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'copied']),
  model: z.string(),
  created_at: z.string(),
  copied_at: z.string().nullable(),
})

const linkRow = z.object({ draft_id: z.string(), commit_sha: z.string() })

function note(code: string | undefined) {
  console.warn('drafts: query failed', code ?? 'unknown')
}

async function shasFor(
  draftIds: string[],
): Promise<Map<string, string[]> | null> {
  const map = new Map<string, string[]>()
  if (draftIds.length === 0) return map
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('draft_commits')
    .select('draft_id, commit_sha')
    .in('draft_id', draftIds)
  if (error) {
    note(error.code)
    return null
  }
  const links = z.array(linkRow).safeParse(data)
  if (!links.success) return null
  for (const link of links.data) {
    map.set(link.draft_id, [...(map.get(link.draft_id) ?? []), link.commit_sha])
  }
  return map
}

function toDraft(r: z.infer<typeof row>, shas: string[]): Draft {
  return {
    id: r.id,
    projectId: r.project_id,
    body: r.body,
    status: r.status,
    model: r.model,
    createdAt: r.created_at,
    copiedAt: r.copied_at,
    shas,
  }
}

// The project's newest drafts. null if they could not be read.
export async function listRecentDrafts(
  userId: string,
  projectId: string,
  limit = 10,
): Promise<Draft[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drafts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    note(error.code)
    return null
  }
  const rows = z.array(row).safeParse(data)
  if (!rows.success) return null
  const shas = await shasFor(rows.data.map((r) => r.id))
  if (shas === null) return null
  return rows.data.map((r) => toDraft(r, shas.get(r.id) ?? []))
}

// Commits that appear in a COPIED draft of this project: "used in a draft".
// Full shas, lower case. null if they could not be read.
export async function coveredShas(
  userId: string,
  projectId: string,
): Promise<string[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drafts')
    .select('id')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .eq('status', 'copied')
  if (error) {
    note(error.code)
    return null
  }
  const ids = z.array(z.object({ id: z.string() })).safeParse(data)
  if (!ids.success) return null
  const map = await shasFor(ids.data.map((r) => r.id))
  if (map === null) return null
  return [...new Set([...map.values()].flat())]
}

export async function updateDraftBody(
  userId: string,
  draftId: string,
  body: string,
): Promise<'ok' | 'not_found' | 'failed'> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drafts')
    .update({ body })
    .eq('id', draftId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    note(error.code)
    return 'failed'
  }
  return (data as unknown[]).length > 0 ? 'ok' : 'not_found'
}

export async function deleteDraft(
  userId: string,
  draftId: string,
): Promise<'ok' | 'not_found' | 'failed'> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drafts')
    .delete()
    .eq('id', draftId)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    note(error.code)
    return 'failed'
  }
  return (data as unknown[]).length > 0 ? 'ok' : 'not_found'
}

// Marks the user's own draft copied, which marks its commits as covered.
export async function markDraftCopied(
  draftId: string,
): Promise<'ok' | 'not_found' | 'failed'> {
  const supabase = await createClient()
  const response = await supabase.rpc('mark_draft_copied', {
    p_draft_id: draftId,
  })
  if (response.error) {
    note(response.error.code)
    return 'failed'
  }
  const copied: unknown = response.data
  return copied === true ? 'ok' : 'not_found'
}
