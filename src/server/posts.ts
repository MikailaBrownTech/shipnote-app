import 'server-only'
import { z } from 'zod'
import type { DraftInput, ScheduleInput } from '@/lib/posts'
import { createClient } from '@/lib/supabase/server'

// What the Posts page reads: the user's own drafts and schedules, with their own
// session, so row-level security applies. Nothing here writes or logs a value;
// a failure is a null.

export const POSTS_READ_LIMIT = 100

const draftRow = z.object({
  id: z.string(),
  project_id: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'copied']),
  created_at: z.string(),
})

const scheduleRow = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  draft_id: z.string().nullable(),
  body: z.string(),
  status: z.enum([
    'scheduling',
    'scheduled',
    'canceled',
    'failed',
    'published',
  ]),
  scheduled_for: z.string(),
  created_at: z.string(),
})

function note(code: string | undefined) {
  console.warn('posts: query failed', code ?? 'unknown')
}

export type UserPosts = {
  drafts: DraftInput[]
  schedules: ScheduleInput[]
  // True when either list was cut at the read limit.
  truncated: boolean
}

export async function listUserPosts(userId: string): Promise<UserPosts | null> {
  const supabase = await createClient()
  const [drafts, schedules] = await Promise.all([
    supabase
      .from('drafts')
      .select('id, project_id, body, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(POSTS_READ_LIMIT),
    supabase
      .from('scheduled_posts')
      .select(
        'id, project_id, draft_id, body, status, scheduled_for, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(POSTS_READ_LIMIT),
  ])
  if (drafts.error) {
    note(drafts.error.code)
    return null
  }
  if (schedules.error) {
    note(schedules.error.code)
    return null
  }
  const d = z.array(draftRow).safeParse(drafts.data)
  const s = z.array(scheduleRow).safeParse(schedules.data)
  if (!d.success || !s.success) return null
  return {
    drafts: d.data.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      body: r.body,
      status: r.status,
      createdAt: r.created_at,
    })),
    schedules: s.data.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      draftId: r.draft_id,
      body: r.body,
      status: r.status,
      scheduledFor: r.scheduled_for,
      createdAt: r.created_at,
    })),
    truncated:
      d.data.length >= POSTS_READ_LIMIT || s.data.length >= POSTS_READ_LIMIT,
  }
}
