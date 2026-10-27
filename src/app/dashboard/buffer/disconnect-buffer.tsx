'use client'

import { useState } from 'react'
import { BUFFER_REVOKE_NOTE } from '@/lib/buffer-flash'
import styles from '../projects/projects.module.css'
import { disconnectBufferAction } from './actions'

// Disconnect asks first. It deletes Shipnote's copy of the tokens. Buffer
// gives apps no way to revoke access, so the person is told to remove Shipnote
// in their Buffer settings too. They may cancel their scheduled posts first.
export function DisconnectBuffer() {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        className="button button-soft"
        onClick={() => {
          setConfirming(true)
        }}
      >
        Disconnect Buffer
      </button>
    )
  }

  return (
    <form
      action={disconnectBufferAction}
      className={`on-pink ${styles.confirm}`}
    >
      <p>
        Disconnect Buffer from Shipnote? Shipnote will delete its saved access
        to your Buffer account. Posts you have already scheduled stay in Buffer
        and will still publish unless they are cancelled.
      </p>
      <p>{BUFFER_REVOKE_NOTE}</p>
      <label>
        <input type="checkbox" name="cancel_first" defaultChecked /> Cancel my
        scheduled posts in Buffer first
      </label>
      <div className={styles.confirmActions}>
        <button type="submit" className="button button-dark">
          Yes, disconnect
        </button>
        <button
          type="button"
          className="button button-light"
          onClick={() => {
            setConfirming(false)
          }}
        >
          Keep it connected
        </button>
      </div>
    </form>
  )
}
