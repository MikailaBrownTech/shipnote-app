import 'server-only'
import { notFound } from 'next/navigation'
import { projectId } from '@/lib/project-schema'
import { getProject, type Project } from '@/server/projects'

// Loads one of the caller's own projects. A malformed id, a missing project and
// someone else's project all end in the same not-found page. null means the
// project could not be loaded (a failure, not an absence).
export async function loadOwnProject(
  userId: string,
  params: Promise<{ id: string }>,
): Promise<Project | null> {
  const { id } = await params
  if (!projectId.safeParse(id).success) notFound()
  const result = await getProject(userId, id)
  if (!result.ok && result.reason === 'not_found') notFound()
  return result.ok ? result.value : null
}
