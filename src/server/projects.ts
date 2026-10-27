import 'server-only'
import { z } from 'zod'
import { projectId, STAGES, type ProjectInput } from '@/lib/project-schema'
import { createClient } from '@/lib/supabase/server'

// All access goes through the Supabase server client with the signed-in user's
// session, so row-level security applies to every query. The service role key
// is not used here. The explicit user_id filters below are a second fence, not
// the first.
//
// Nothing here logs or returns project text. Failures return a fixed reason,
// and the only thing ever logged is a Postgres error code.

export type Project = {
  id: string
  name: string
  summary: string | null
  stage: (typeof STAGES)[number]
  notes: string
  createdAt: string
  updatedAt: string
}

export type ProjectsResult<T> =
  | { ok: true; value: T }
  // not_found covers a missing id and someone else's id alike.
  | { ok: false; reason: 'not_found' | 'limit' | 'failed' }

const failed = { ok: false, reason: 'failed' } as const
const notFound = { ok: false, reason: 'not_found' } as const

// SQLSTATE raised by the database trigger that caps projects per user.
export const PROJECT_LIMIT_SQLSTATE = 'SN001'

const COLUMNS = 'id, name, summary, stage, notes, created_at, updated_at'

const row = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  stage: z.enum(STAGES),
  notes: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

function toProject(data: unknown): Project | null {
  const parsed = row.safeParse(data)
  if (!parsed.success) return null
  const r = parsed.data
  return {
    id: r.id,
    name: r.name,
    summary: r.summary,
    stage: r.stage,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// Fixed text plus the SQLSTATE, which is not user data.
function note(code: string | undefined) {
  console.warn('projects: query failed', code ?? 'unknown')
}

function single(data: unknown): ProjectsResult<Project> {
  const project = toProject(data)
  return project ? { ok: true, value: project } : failed
}

export async function listProjects(
  userId: string,
): Promise<ProjectsResult<Project[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) {
    note(error.code)
    return failed
  }
  const projects = (data as unknown[]).map(toProject)
  if (projects.some((project) => project === null)) return failed
  return { ok: true, value: projects as Project[] }
}

export async function getProject(
  userId: string,
  id: string,
): Promise<ProjectsResult<Project>> {
  if (!projectId.safeParse(id).success) return notFound
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select(COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    note(error.code)
    return failed
  }
  return data ? single(data) : notFound
}

export async function createProject(
  userId: string,
  input: ProjectInput,
): Promise<ProjectsResult<Project>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, ...input })
    .select(COLUMNS)
    .single()
  if (error) {
    if (error.code === PROJECT_LIMIT_SQLSTATE) {
      return { ok: false, reason: 'limit' }
    }
    note(error.code)
    return failed
  }
  return single(data)
}

export async function updateProject(
  userId: string,
  id: string,
  input: ProjectInput,
): Promise<ProjectsResult<Project>> {
  if (!projectId.safeParse(id).success) return notFound
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select(COLUMNS)
    .maybeSingle()
  if (error) {
    note(error.code)
    return failed
  }
  // No row means it is missing or not the caller's. The same answer either way.
  return data ? single(data) : notFound
}

export async function deleteProject(
  userId: string,
  id: string,
): Promise<ProjectsResult<null>> {
  if (!projectId.safeParse(id).success) return notFound
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
  if (error) {
    note(error.code)
    return failed
  }
  return (data as unknown[]).length > 0 ? { ok: true, value: null } : notFound
}
