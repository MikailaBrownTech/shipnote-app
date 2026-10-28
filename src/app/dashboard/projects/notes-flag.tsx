import Link from 'next/link'
import { Icon } from '../icons'
import styles from './notes-flag.module.css'

// A gentle flag for when what Shipnote knows about a project is out of date.
// Posts and drafts are written from the project's notes and summary, so the fix
// for wrong information is to update them. Plain text and one link; it changes
// nothing itself.
export function NotesFlag({
  projectId,
  where = 'notes',
}: {
  projectId: string
  where?: 'notes' | 'drafts'
}) {
  return (
    <p className={styles.flag}>
      <span className={styles.icon}>
        <Icon name="flag" size={16} />
      </span>
      <span>
        {where === 'notes'
          ? 'Incorrect information? Try updating the notes and summary with the current project progress.'
          : 'A draft got something wrong? Drafts are written from your notes and summary, so try updating them with the current project progress.'}{' '}
        <Link href={`/dashboard/projects/${projectId}/edit`}>
          Update notes and summary
        </Link>
      </span>
    </p>
  )
}
