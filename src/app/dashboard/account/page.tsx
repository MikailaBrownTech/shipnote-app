import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { confirmationText, hasRecentSignIn } from '@/server/delete-account'
import styles from '../dashboard.module.css'
import { PageHeader } from '../projects/page-header'
import { reauthenticate } from './actions'
import { DeleteForm } from './delete-form'

export const metadata: Metadata = { title: 'Account' }

export default function AccountPage() {
  return (
    <main className={styles.main}>
      {/* Reads the session, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your account</p>}>
        <Account />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Account() {
  const user = await requireUser()
  const recent = hasRecentSignIn(user)

  return (
    <>
      <PageHeader />

      <h1 className={styles.title}>Account</h1>

      <section
        className={`card ${styles.danger}`}
        aria-labelledby="delete-title"
      >
        <h2 id="delete-title">Delete your account</h2>
        <p>
          This permanently deletes your account and everything in it. It cannot
          be undone, and your invite cannot be used again.
        </p>

        {recent ? (
          <DeleteForm phrase={confirmationText(user)} />
        ) : (
          <form action={reauthenticate} className={styles.dangerForm}>
            <p role="status">Sign in again to delete your account.</p>
            <button type="submit" className="button button-dark">
              Sign in again
            </button>
          </form>
        )}
      </section>
    </>
  )
}
