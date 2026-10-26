import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { signOut } from '@/app/auth/actions'
import { requireUser } from '@/lib/auth'
import styles from './dashboard.module.css'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <main className={`page ${styles.main}`}>
      {/* Reads the session, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your dashboard</p>}>
        <Dashboard />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Dashboard() {
  const user = await requireUser()

  return (
    <>
      <header className={styles.header}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
        <form action={signOut}>
          <button type="submit" className="button button-soft">
            Sign out
          </button>
        </form>
      </header>

      <div className={styles.top}>
        <h1 className={styles.title}>Dashboard</h1>
        {user.email ? (
          <p className={`card ${styles.who}`}>Signed in as {user.email}</p>
        ) : null}
      </div>

      <section className={`card ${styles.empty}`} aria-labelledby="empty-title">
        <h2 id="empty-title">Nothing here yet</h2>
        <p>
          Projects and drafts are not available in this early build. When they
          are, they will show up on this page.
        </p>
      </section>
    </>
  )
}
