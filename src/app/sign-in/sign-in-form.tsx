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
        Sign in with GitHub
      </button>

      <p className={styles.or}>or get a sign-in link by email</p>

      <form
        action={sendLink}
        noValidate
        onSubmit={() => {
          setGithubStatus('idle')
        }}
      >
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          disabled={working}
        />
        <button type="submit" className="button button-soft" disabled={working}>
          Email me a link
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
