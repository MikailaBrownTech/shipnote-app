'use client'

import { useState } from 'react'
import styles from '../projects/projects.module.css'

// Disconnect asks first. It removes the connection in Shipnote only; it does
// not uninstall the App on GitHub. The action is passed in, so the project page
// and the dashboard can each send the person back to where they were.
export function DisconnectGithub({
  action,
  installationId,
}: {
  action: (form: FormData) => Promise<void>
  installationId: number
}) {
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
        Disconnect GitHub
      </button>
    )
  }

  return (
    <form action={action} className={`on-pink ${styles.confirm}`}>
      <p>
        Disconnect GitHub from Shipnote? This removes the connection here, for
        all your projects. It does not uninstall the app on GitHub; you can do
        that at github.com/settings/installations.
      </p>
      <input type="hidden" name="installation" value={String(installationId)} />
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
          Cancel
        </button>
      </div>
    </form>
  )
}
