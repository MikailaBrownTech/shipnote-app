import Link from 'next/link'

// Shown for any missing page, and for a project that is missing or not yours.
// The wording never says which.
export default function NotFound() {
  return (
    <main className="page" style={{ paddingBlock: '4rem' }}>
      <Link href="/" className="wordmark">
        Shipnote
      </Link>
      <h1 style={{ marginTop: '3rem', fontSize: 'clamp(2.5rem, 9vw, 4rem)' }}>
        Page not found
      </h1>
      <p style={{ marginTop: '1rem', color: 'var(--ink-soft)' }}>
        This page does not exist, or you do not have access to it.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/dashboard" className="button">
          Go to dashboard
        </Link>
      </p>
    </main>
  )
}
