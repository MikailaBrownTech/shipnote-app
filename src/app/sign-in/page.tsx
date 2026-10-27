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

const features = [
  {
    title: 'Drafts from your work',
    body: 'Turn project docs and tagged commits into post drafts.',
    tone: 'violet',
    icon: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  },
  {
    title: 'Review & edit',
    body: 'Change anything in a draft until it sounds like you.',
    tone: 'rose',
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </>
    ),
  },
  {
    title: 'Share what you shipped',
    body: 'Copy the draft and post it yourself. Shipnote never posts for you.',
    tone: 'teal',
    icon: (
      <>
        <rect x="9" y="3" width="11" height="14" rx="2" />
        <path d="M5 8H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" />
      </>
    ),
  },
] as const

export default function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  return (
    <main className={`page ${styles.main}`}>
      <div className={styles.blobs} aria-hidden="true" />

      <Link href="/" className={`wordmark ${styles.brand}`}>
        Shipnote
      </Link>

      {/* The form comes first in reading order; the grid puts it on the right. */}
      <section className={styles.card} aria-labelledby="sign-in-title">
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
        <h1 id="sign-in-title">Sign in</h1>
        <p className={styles.lead}>
          Shipnote is in early access. Use GitHub, or ask for a link by email.
        </p>

        {/* Reads cookies and searchParams, so it sits behind Suspense. */}
        <Suspense fallback={null}>
          <SignInNotice searchParams={searchParams} />
        </Suspense>

        <SignInForm />
      </section>

      <section className={styles.hero} aria-labelledby="hero-title">
        <h2 id="hero-title" className={styles.headline}>
          Turn your <span className={styles.blue}>GitHub activity</span> into
          LinkedIn <span className={styles.pink}>posts.</span>
        </h2>
        <p className={styles.sub}>
          Shipnote drafts LinkedIn posts from your project docs and the commits
          you tag. You edit a draft and copy it. Nothing is posted for you.
        </p>

        <ul className={styles.features}>
          {features.map((feature) => (
            <li key={feature.title}>
              <span className={`${styles.icon} ${styles[feature.tone]}`}>
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {feature.icon}
                </svg>
              </span>
              <div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* A made-up preview, so nothing here is a real customer or repo. */}
        <div className={styles.preview} aria-hidden="true">
          <div className={styles.window}>
            <div className={styles.dots}>
              <i />
              <i />
              <i />
            </div>
            <div className={styles.windowBody}>
              <nav>
                <b>Shipnote</b>
                <span className={styles.active}>Dashboard</span>
                <span>Drafts</span>
                <span>Settings</span>
              </nav>
              <div className={styles.drafts}>
                <b>Drafts</b>
                <div className={`${styles.draft} ${styles.d1}`}>
                  CSV export for usage reports
                  <small>Draft · ready to edit</small>
                </div>
                <div className={`${styles.draft} ${styles.d2}`}>
                  Reports load in 2 seconds
                  <small>Draft · ready to edit</small>
                </div>
                <div className={`${styles.draft} ${styles.d3}`}>
                  Fixed the timezone bug
                  <small>Draft · ready to edit</small>
                </div>
              </div>
            </div>
          </div>
          <p className={styles.script}>
            From code
            <br />
            to connections.
          </p>
        </div>
      </section>
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
