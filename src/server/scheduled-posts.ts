import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// What a signed-in user may read about their own Buffer connection and
// schedules, with their own session, so row-level security applies. Tokens are
// not readable by any user role and are not here. Writes go through
// supabase-admin.ts. Nothing here logs a value; failures are plain results.

export type ConnectionState = 'none' | 'connected' | 'needs_reconnect'

export type ConnectionStatus = {
  state: ConnectionState
  connectedAt: string | null
}

const statusRow = z.object({
  status: z.enum(['connected', 'needs_reconnect']),
  connected_at: z.string().nullable(),
})

function note(code: string | undefined) {
  console.warn('scheduling: query failed', code ?? 'unknown')
}

// The caller's own connection: whether it exists and its state. null if it
// could not be read.
export async function getConnectionStatus(): Promise<ConnectionStatus | null> {
  const supabase = await createClient()
  const response = await supabase.rpc('buffer_connection_status')
  if (response.error) {
    note(response.error.code)
    return null
  }
  const data: unknown = response.data
  const rows = z.array(statusRow).safeParse(data)
  if (!rows.success) return null
  const row = rows.data.at(0)
  return row
    ? { state: row.status, connectedAt: row.connected_at }
    : { state: 'none', connectedAt: null }
}

export type ScheduleStatus =
  'scheduling' | 'scheduled' | 'canceled' | 'failed' | 'published'

export type ScheduledPost = {
  id: string
  projectId: string | null
  draftId: string | null
  body: string
  channelLabel: string | null
  scheduledFor: string
  bufferPostId: string | null
  status: ScheduleStatus
  failureCode: string | null
  createdAt: string
}

const COLUMNS =
  'id, project_id, draft_id, body, channel_label, scheduled_for, buffer_post_id, status, failure_code, created_at'

const postRow = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  draft_id: z.string().nullable(),
  body: z.string(),
  channel_label: z.string().nullable(),
  scheduled_for: z.string(),
  buffer_post_id: z.string().nullable(),
  status: z.enum([
    'scheduling',
    'scheduled',
    'canceled',
    'failed',
    'published',
  ]),
  failure_code: z.string().nullable(),
  created_at: z.string(),
})

function toPost(row: z.infer<typeof postRow>): ScheduledPost {
  return {
    id: row.id,
    projectId: row.project_id,
    draftId: row.draft_id,
    body: row.body,
    channelLabel: row.channel_label,
    scheduledFor: row.scheduled_for,
    bufferPostId: row.buffer_post_id,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: row.created_at,
  }
}

// The project's schedules, newest first. null if they could not be read.
export async function listProjectSchedules(
  userId: string,
  projectId: string,
  limit = 20,
): Promise<ScheduledPost[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    note(error.code)
    return null
  }
  const rows = z.array(postRow).safeParse(data)
  return rows.success ? rows.data.map(toPost) : null
}

// One of the user's own schedules, or 'not_found'.
export async function getScheduledPost(
  userId: string,
  id: string,
): Promise<ScheduledPost | 'not_found' | 'failed'> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    note(error.code)
    return 'failed'
  }
  if (data === null) return 'not_found'
  const row = postRow.safeParse(data)
  return row.success ? toPost(row.data) : 'failed'
}

// The draft's active schedule (scheduling or scheduled), if any.
export async function activeScheduleForDraft(
  userId: string,
  draftId: string,
): Promise<ScheduledPost | null | 'failed'> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('draft_id', draftId)
    .in('status', ['scheduling', 'scheduled'])
    .maybeSingle()
  if (error) {
    note(error.code)
    return 'failed'
  }
  if (data === null) return null
  const row = postRow.safeParse(data)
  return row.success ? toPost(row.data) : 'failed'
}

// Every schedule that could still publish, for cleanup when an account is
// deleted or Buffer is disconnected.
export async function listActiveSchedules(
  userId: string,
): Promise<ScheduledPost[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .in('status', ['scheduling', 'scheduled'])
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) {
    note(error.code)
    return null
  }
  const rows = z.array(postRow).safeParse(data)
  return rows.success ? rows.data.map(toPost) : null
}
