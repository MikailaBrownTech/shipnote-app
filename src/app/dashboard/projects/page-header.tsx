import Link from 'next/link'
import styles from '../dashboard.module.css'

// A back link at the top of a page below the dashboard.
export function PageHeader({
  backHref = '/dashboard',
  backLabel = 'Back to dashboard',
}: {
  backHref?: string
  backLabel?: string
}) {
  return (
    <header className={styles.header}>
      <Link href={backHref} className="button button-soft">
        {backLabel}
      </Link>
    </header>
  )
}
