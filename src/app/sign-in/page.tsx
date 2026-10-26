import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { parseSignInError, type SignInError } from '@/lib/auth-errors'
import { SignInForm } from './sign-in-form'
import styles from './sign-in.module.css'

export const metadata: Metadata = { title: 'Sign in' }

// Plain wording, no internals, and nothing that says whether an email is invited.
const errorMessages: Record<SignInError, string> = {
  invite: 'Sign-up is invite only.',
  expired:
    'That sign-in link expired or was already used. Ask for a new one, and open it in the same browser.',
  denied:
    'GitHub access was not granted. Try again, or use an email link instead.',
  limited: 'Too many attempts. Try again in a few minutes.',
  signout:
    'You are signed out here, but we could not sign you out everywhere. Sign in and try Sign out everywhere again.',
  failed: 'Something went wrong. Try again.',
}

export default function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  return (
    <main className={`page ${styles.main}`}>
      <Link href="/" className="wordmark">
        Shipnote
      </Link>
      <div className={styles.titleBox}>
        <h1>Sign in</h1>
        <p className={styles.lead}>
          Shipnote is in early access. Use GitHub, or ask for a link by email.
        </p>
      </div>

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
  const { error, reauth } = await searchParams
  // reauth=1 lets a signed-in user through, to sign in again.
  if (reauth !== '1' && (await getCurrentUser())) redirect('/dashboard')

  // Only a known code is shown, as fixed text. The raw parameter is never
  // echoed back.
  const code = parseSignInError(error)
  if (!code) return null
  return (
    <p role="alert" className={`on-pink ${styles.alert}`}>
      {errorMessages[code]}
    </p>
  )
}
