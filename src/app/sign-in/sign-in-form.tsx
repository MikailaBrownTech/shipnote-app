'use client'

import { useActionState, useState, useTransition } from 'react'
import { sendSignInLink, signInWithGitHub, type SignInState } from './actions'
import styles from './sign-in.module.css'

type Status = SignInState['status']

const messages: Record<Exclude<Status, 'idle'>, string> = {
  sent: 'If that address can sign in, a link is on its way. Open it in this browser.',
  invalid: 'Enter a valid email address.',
  limited: 'Too many attempts. Try again in a few minutes.',
  invite: 'Sign-up is invite only.',
  failed: 'Something went wrong. Try again.',
}

const initial: SignInState = { status: 'idle' }

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={styles.arrow}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function SignInForm() {
  const [linkState, sendLink, sending] = useActionState(sendSignInLink, initial)
  const [githubStatus, setGithubStatus] = useState<Status>('idle')
  const [startingGitHub, startGitHub] = useTransition()

  const status = githubStatus === 'idle' ? linkState.status : githubStatus
  const working = sending || startingGitHub
  const bad = status !== 'idle' && status !== 'sent'

  return (
    <div className={styles.form}>
      <button
        type="button"
        className="button button-dark"
        disabled={working}
        onClick={() => {
          setGithubStatus('idle')
          startGitHub(async () => {
            // On success the action redirects, so a result means a problem.
            const result = await signInWithGitHub()
            setGithubStatus(result.status)
          })
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
        </svg>
        Sign in with GitHub
        <Arrow />
      </button>

      <p className={styles.or}>or</p>

      <form
        action={sendLink}
        noValidate
        onSubmit={() => {
          setGithubStatus('idle')
        }}
      >
        <label htmlFor="email">Email address</label>
        <div className={styles.field}>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            required
            disabled={working}
          />
        </div>
        <button type="submit" className="button button-soft" disabled={working}>
          Email me a link
          <Arrow />
        </button>
      </form>

      <p
        role="status"
        className={`${styles.status} ${bad ? 'on-pink' : 'on-azure'}`}
      >
        {status === 'idle' ? '' : messages[status]}
      </p>
    </div>
  )
}
