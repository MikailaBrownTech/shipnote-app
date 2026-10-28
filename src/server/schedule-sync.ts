import 'server-only'
import { BufferError } from './buffer'
import { rateLimit } from './rate-limit'
import { listDueSchedules } from './scheduled-posts'
import { refreshOne, schedulingIsEnabled } from './scheduling'

// Keeps scheduled posts honest without a button. Buffer sends a post at its time
// and Shipnote is not told, so when the Posts page, the Calendar or a project's
// Drafts tab is opened, the posts whose time has passed and that are still
// marked scheduled are checked with Buffer, and recorded as published, failed or
// canceled (removed in Buffer).
//
// Light on purpose: at most 5 posts a time, one after another, within a time
// limit, and rate limited per user. It never throws and never blocks the page
// for long: anything it cannot do is left for the next visit. Nothing here logs
// a post, a Buffer id, a token or a Buffer response; only a fixed kind.

export const SYNC_BATCH = 5
export const SYNC_BUDGET_MS = 8000

// How many posts changed.
export async function syncDueSchedules(
  userId: string,
  nowMs: number = Date.now(),
): Promise<number> {
  if (!schedulingIsEnabled()) return 0
  const due = await listDueSchedules(
    userId,
    new Date(nowMs).toISOString(),
    SYNC_BATCH,
  )
  if (!due || due.length === 0) return 0
  // Only now, with something to check, does a visit use the user's allowance.
  if (!(await rateLimit('scheduleSync', userId))) return 0

  const started = Date.now()
  let changed = 0
  for (const post of due) {
    if (Date.now() - started > SYNC_BUDGET_MS) break
    try {
      if (await refreshOne({ userId, post, nowMs })) changed += 1
    } catch (error) {
      // Not connected, rate limited or unreachable: stop and try next visit.
      console.warn(
        'schedule sync: stopped',
        error instanceof BufferError ? error.kind : 'unexpected',
      )
      break
    }
  }
  return changed
}
