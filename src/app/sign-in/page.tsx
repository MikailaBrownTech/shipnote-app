import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { SignInForm } from './sign-in-form'
import styles from './sign-in.module.css'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  return (
    <main className={`page ${styles.main}`}>
      <Link href="/" className="wordmark">
        Shipnote
      </Link>
      <h1>Sign in</h1>
      <p className={styles.lead}>
        Shipnote is in early access. Use GitHub, or ask for a link by email.
      </p>

      {/* Reads cookies and searchParams, so it sits behind Suspense. */}
      <Suspense fallback={null}>
        <SignInNotice searchParams={searchParams} />
      </Suspense>

      <SignInForm />
    </main>
  )
}

async function SignInNotice({
  searchParams,
}: {
  searchParams: PageProps<'/sign-in'>['searchParams']
}) {
  if (await getCurrentUser()) redirect('/dashboard')

  // Only a known code is shown. The raw parameter is never echoed back.
  const { error } = await searchParams
  if (error !== 'callback') return null
  return (
    <p role="alert" className={styles.error}>
      That sign-in link did not work. It may have expired or been opened in a
      different browser. Try again.
    </p>
  )
}
