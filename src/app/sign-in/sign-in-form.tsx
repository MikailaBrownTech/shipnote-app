'use client'

import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createClient } from '@/lib/supabase/client'
import styles from './sign-in.module.css'

type Status = 'idle' | 'working' | 'sent' | 'error'

const email = z.email()
const callbackUrl = `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`

export function SignInForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  function fail(text: string) {
    setStatus('error')
    setMessage(text)
  }

  async function signInWithGitHub() {
    setStatus('working')
    setMessage('')
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: callbackUrl },
    })
    if (error) fail('We could not start the GitHub sign-in. Try again.')
  }

  async function sendLink(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = new FormData(event.currentTarget).get('email')
    const address = email.safeParse(typeof raw === 'string' ? raw.trim() : '')
    if (!address.success) {
      fail('Enter a valid email address.')
      return
    }

    setStatus('working')
    setMessage('')
    const { error } = await createClient().auth.signInWithOtp({
      email: address.data,
      options: { emailRedirectTo: callbackUrl },
    })
    if (error) {
      fail('We could not send the link. Wait a minute and try again.')
      return
    }

    // Same message whether or not the address already has an account.
    setStatus('sent')
    setMessage(
      'If that address can sign in, a link is on its way. Open it in this browser.',
    )
  }

  const working = status === 'working'

  return (
    <div className={styles.form}>
      <button
        type="button"
        className="button button-dark"
        onClick={() => void signInWithGitHub()}
        disabled={working}
      >
        Sign in with GitHub
      </button>

      <p className={styles.or}>or get a sign-in link by email</p>

      <form onSubmit={(event) => void sendLink(event)} noValidate>
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
        className={
          status === 'error'
            ? `${styles.status} on-pink`
            : `${styles.status} on-azure`
        }
      >
        {message}
      </p>
    </div>
  )
}
