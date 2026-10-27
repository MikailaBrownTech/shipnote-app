import Link from 'next/link'
import styles from '../dashboard.module.css'

export function PageHeader({
  backHref = '/dashboard',
  backLabel = 'Back to dashboard',
}: {
  backHref?: string
  backLabel?: string
}) {
  return (
    <header className={styles.header}>
      <Link href="/" className="wordmark">
        Shipnote
      </Link>
      <Link href={backHref} className="button button-soft">
        {backLabel}
      </Link>
    </header>
  )
}
