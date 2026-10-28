import { autoDraftsOn, listAutoJobs, readAutoDraft } from '@/server/auto-drafts'
import { draftsLeftToday } from '@/server/draft-generation'
import { coveredShas, listRecentDrafts } from '@/server/drafts'
import type { Project } from '@/server/projects'
import {
  getConnectionStatus,
  listProjectSchedules,
} from '@/server/scheduled-posts'
import { schedulingIsEnabled } from '@/server/scheduling'
import { readVoice } from '@/server/voice'
import {
  DraftWorkshop,
  type AutoView,
  type SchedulingView,
} from './draft-controls'
import styles from './projects.module.css'

// The Drafts tab: loads the person's own recent drafts, which commits are
// already in a copied draft, how many drafts are left today and, while
// scheduling is on, their Buffer connection and this project's schedules.
// Rendered only while AI is on.
export async function DraftPanel({
  userId,
  project,
}: {
  userId: string
  project: Project
}) {
  const schedulingOn = schedulingIsEnabled()
  const autoOn = autoDraftsOn()
  const [recent, covered, left, connection, schedules, switchOn, jobs, voice] =
    await Promise.all([
      listRecentDrafts(userId, project.id, 10),
      coveredShas(userId, project.id),
      draftsLeftToday(userId),
      schedulingOn ? getConnectionStatus() : null,
      schedulingOn ? listProjectSchedules(userId, project.id, 20) : null,
      autoOn ? readAutoDraft(userId, project.id) : null,
      autoOn ? listAutoJobs(userId, project.id, 20) : null,
      readVoice(userId),
    ])

  // The automatic drafts switch and its jobs. If they cannot be read, the card
  // is simply not shown.
  let auto: AutoView | null = null
  const autoDraftIds = new Set<string>()
  if (autoOn && switchOn !== null && jobs !== null) {
    for (const job of jobs) {
      if (job.status === 'done' && job.draftId) autoDraftIds.add(job.draftId)
    }
    auto = {
      enabled: switchOn,
      canEnable:
        project.repoFullName !== null && project.installationId !== null,
      jobs: jobs.map((job) => ({
        id: job.id,
        commitSha: job.commitSha,
        status: job.status,
        reason: job.reason,
        createdAt: job.createdAt,
      })),
    }
  }

  if (recent === null) {
    return (
      <p role="alert" className={`on-pink ${styles.notice}`}>
        We could not load your drafts. Try again in a moment.
      </p>
    )
  }

  // If Buffer's state cannot be read, scheduling is simply not offered.
  let scheduling: SchedulingView | null = null
  if (schedulingOn && connection && schedules) {
    const byDraft: SchedulingView['byDraft'] = {}
    for (const post of schedules) {
      if (
        post.draftId &&
        (post.status === 'scheduling' ||
          post.status === 'scheduled' ||
          post.status === 'published') &&
        !Object.hasOwn(byDraft, post.draftId)
      ) {
        byDraft[post.draftId] = {
          id: post.id,
          scheduledFor: post.scheduledFor,
          channelLabel: post.channelLabel,
          status: post.status,
          failureCode: post.failureCode,
        }
      }
    }
    scheduling = {
      connection: connection.state,
      byDraft,
      posts: schedules.map((post) => ({
        id: post.id,
        scheduledFor: post.scheduledFor,
        channelLabel: post.channelLabel,
        status: post.status,
        failureCode: post.failureCode,
        body: post.body,
      })),
    }
  }

  return (
    <DraftWorkshop
      projectId={project.id}
      canUseCommits={
        project.repoFullName !== null && project.installationId !== null
      }
      initialLeft={left}
      covered={covered ?? []}
      recent={recent.map((draft) => ({
        id: draft.id,
        body: draft.body,
        status: draft.status,
        createdAt: draft.createdAt,
        auto: autoDraftIds.has(draft.id),
      }))}
      scheduling={scheduling}
      auto={auto}
      savedTone={voice === 'failed' ? null : (voice?.tone ?? 'professional')}
    />
  )
}
