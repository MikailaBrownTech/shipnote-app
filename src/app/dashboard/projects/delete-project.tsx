'use client'

import { useActionState, useState } from 'react'
import { deleteProjectAction, type DeleteProjectState } from './actions'
import styles from './projects.module.css'

// Delete asks first. The server also refuses a request that lacks the
// confirmation field, which only the second step sends.
export function DeleteProject({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false)
  const [state, run, pending] = useActionState(
    deleteProjectAction.bind(null, id),
    { status: 'idle' } as DeleteProjectState,
  )

  if (!confirming) {
    return (
      <button
        type="button"
        className="button button-light"
        onClick={() => {
          setConfirming(true)
        }}
      >
        Delete project
      </button>
    )
  }

  return (
    <form action={run} className={`on-pink ${styles.confirm}`}>
      <p>Delete this project and its notes? This cannot be undone.</p>
      <input type="hidden" name="confirm" value="yes" />
      <div className={styles.confirmActions}>
        <button type="submit" className="button button-dark" disabled={pending}>
          Yes, delete it
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
      {state.status === 'failed' ? (
        <p role="alert">We could not delete the project. Try again.</p>
      ) : null}
    </form>
  )
}
