import type { Metadata } from 'next'
import Link from 'next/link'
import styles from '../dashboard/dashboard.module.css'

export const metadata: Metadata = { title: 'Account deleted' }

export default function AccountDeletedPage() {
  return (
    <main className={`page ${styles.main}`}>
      <header className={styles.header}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
      </header>
      <h1 className={styles.title}>Your account was deleted</h1>
      <p className={styles.who}>Everything tied to it has been removed.</p>
      <p>
        <Link href="/" className="button">
          Back to the home page
        </Link>
      </p>
    </main>
  )
}
