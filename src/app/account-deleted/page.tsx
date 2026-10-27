import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { BUFFER_REVOKE_NOTE } from '@/lib/buffer-flash'
import { parseDeletedNotes } from '@/lib/account-deleted'
import styles from '../dashboard/dashboard.module.css'

export const metadata: Metadata = { title: 'Account deleted' }

export default function AccountDeletedPage({
  searchParams,
}: PageProps<'/account-deleted'>) {
  return (
    <main className={`page ${styles.main}`}>
      <header className={styles.header}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
      </header>
      <h1 className={styles.title}>Your account was deleted</h1>
      <p className={styles.who}>Everything tied to it has been removed.</p>
      {/* Reads the address, so it sits behind Suspense. */}
      <Suspense fallback={null}>
        <BufferNotes searchParams={searchParams} />
      </Suspense>
      <p>
        <Link href="/" className="button">
          Back to the home page
        </Link>
      </p>
    </main>
  )
}

// If the person had connected Buffer, say what is left for them to do there.
// Shipnote deleted its saved access, but Buffer offers no way for an app to
// revoke it, and posts Shipnote could not cancel may still publish.
async function BufferNotes({
  searchParams,
}: {
  searchParams: PageProps<'/account-deleted'>['searchParams']
}) {
  const { buffer, left } = parseDeletedNotes(await searchParams)
  if (!buffer && left === 0) return null
  return (
    <section aria-labelledby="buffer-after-title">
      <h2 id="buffer-after-title">Buffer</h2>
      {buffer ? (
        <p>
          Shipnote deleted its saved access to your Buffer account.{' '}
          {BUFFER_REVOKE_NOTE}
        </p>
      ) : null}
      {left > 0 ? (
        <p role="alert">
          {String(left)} scheduled post{left === 1 ? '' : 's'} could not be
          cancelled in Buffer and may still publish. Cancel{' '}
          {left === 1 ? 'it' : 'them'} in Buffer.
        </p>
      ) : null}
    </section>
  )
}
