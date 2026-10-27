'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { signOut, signOutEverywhere } from '@/app/auth/actions'
import styles from './dashboard.module.css'
import shell from './shell.module.css'

export function AccountMenu({ email }: { email: string | null }) {
  const [confirming, setConfirming] = useState(false)
  const [state, run, pending] = useActionState(signOutEverywhere, {
    error: null,
  })

  return (
    <details className={styles.menu}>
      <summary className={`button button-light ${styles.menuButton}`}>
        <span className={shell.avatar} aria-hidden="true">
          {(email?.[0] ?? '?').toUpperCase()}
        </span>
        Account
      </summary>
      <div className={`card ${styles.menuPanel}`}>
        {email ? <p className={styles.menuEmail}>{email}</p> : null}

        <Link href="/dashboard/account" className={styles.menuLink}>
          Account settings
        </Link>

        <form action={signOut}>
          <button type="submit" className={styles.menuLink}>
            Sign out
          </button>
        </form>

        {confirming ? (
          <form action={run} className={`on-pink ${styles.confirm}`}>
            <p>
              This signs you out on every device, including this one. Anyone
              using your account will have to sign in again.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="submit"
                className="button button-dark"
                disabled={pending}
              >
                Sign out everywhere
              </button>
              <button
                type="button"
                className="button button-light"
                onClick={() => {
                  setConfirming(false)
                }}
              >
                Cancel
              </button>
            </div>
            {state.error ? <p role="alert">{state.error}</p> : null}
          </form>
        ) : (
          <button
            type="button"
            className={styles.menuLink}
            onClick={() => {
              setConfirming(true)
            }}
          >
            Sign out everywhere
          </button>
        )}
      </div>
    </details>
  )
}
