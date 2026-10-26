'use client'

import { useActionState } from 'react'
import styles from '../dashboard.module.css'
import { deleteAccountAction, type DeleteState } from './actions'

const messages: Record<NonNullable<DeleteState['error']>, string> = {
  confirm: 'That does not match. Type it exactly as shown.',
  recent: 'Sign in again to delete your account.',
  limited: 'Too many attempts. Try again in a few minutes.',
  failed: 'We could not delete your account. Try again.',
}

export function DeleteForm({ phrase }: { phrase: string }) {
  const [state, run, pending] = useActionState(deleteAccountAction, {
    error: null,
  })

  return (
    <form action={run} className={styles.dangerForm}>
      <label htmlFor="confirm">
        To confirm, type <strong>{phrase}</strong>
      </label>
      <input
        id="confirm"
        name="confirm"
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        required
      />
      <button type="submit" className="button button-dark" disabled={pending}>
        Delete my account
      </button>
      <p role="alert" className={state.error ? 'on-pink' : undefined}>
        {state.error ? messages[state.error] : null}
      </p>
    </form>
  )
}
