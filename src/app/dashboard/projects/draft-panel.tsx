import { draftsLeftToday } from '@/server/draft-generation'
import { coveredShas, listRecentDrafts } from '@/server/drafts'
import type { Project } from '@/server/projects'
import { DraftWorkshop } from './draft-controls'
import styles from './projects.module.css'

// The Drafts tab: loads the person's own recent drafts, which commits are
// already in a copied draft, and how many drafts are left today. Rendered only
// while AI is on.
export async function DraftPanel({
  userId,
  project,
}: {
  userId: string
  project: Project
}) {
  const [recent, covered, left] = await Promise.all([
    listRecentDrafts(userId, project.id, 10),
    coveredShas(userId, project.id),
    draftsLeftToday(userId),
  ])

  if (recent === null) {
    return (
      <p role="alert" className={`on-pink ${styles.notice}`}>
        We could not load your drafts. Try again in a moment.
      </p>
    )
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
      }))}
    />
  )
}
