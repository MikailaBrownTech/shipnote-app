'use client'

import { useState, type FormEvent } from 'react'
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

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = email.safeParse(
      new FormData(event.currentTarget).get('email')?.toString().trim(),
    )
    if (!address.success) return fail('Enter a valid email address.')

    setStatus('working')
    setMessage('')
    const { error } = await createClient().auth.signInWithOtp({
      email: address.data,
      options: { emailRedirectTo: callbackUrl },
    })
    if (error) {
      return fail('We could not send the link. Wait a minute and try again.')
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
        onClick={signInWithGitHub}
        disabled={working}
      >
        Sign in with GitHub
      </button>

      <p className={styles.or}>or get a sign-in link by email</p>

      <form onSubmit={sendLink} noValidate>
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
