import { BUFFER_FLASH_MESSAGES, type BufferFlash } from '@/lib/buffer-flash'
import { getConnectionStatus } from '@/server/scheduled-posts'
import { schedulingIsEnabled } from '@/server/scheduling'
import { Icon } from '../icons'
import projectStyles from '../projects/projects.module.css'
import shell from '../shell.module.css'
import { connectBufferAction } from './actions'
import { DisconnectBuffer } from './disconnect-buffer'

// How to use another Buffer account. Buffer decides which account the consent
// screen shows from the browser's own Buffer sign-in, so the person has to
// switch there.
export function SwitchAccountNote() {
  return (
    <p className={shell.panelText}>
      To use a different Buffer account, disconnect here, sign out of Buffer in
      this browser (or sign in to the other account at buffer.com), then connect
      again.
    </p>
  )
}

export function BufferFlashNotice({ flash }: { flash: BufferFlash | null }) {
  if (!flash) return null
  const { tone, text } = BUFFER_FLASH_MESSAGES[flash]
  return (
    <p
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`${tone === 'bad' ? 'on-pink' : 'on-azure'} ${projectStyles.notice}`}
    >
      {text}
    </p>
  )
}

// The Buffer panel on the dashboard home. It renders nothing while scheduling
// is off (the kill switch), so no Buffer text or button appears.
export async function BufferDashboardPanel({
  flash,
}: {
  flash: BufferFlash | null
}) {
  if (!schedulingIsEnabled()) return null

  const status = await getConnectionStatus()

  return (
    <section
      className={`card ${shell.panel}`}
      aria-labelledby="buffer-dashboard-title"
    >
      <h2 id="buffer-dashboard-title" className={shell.panelTitle}>
        Buffer
      </h2>
      <BufferFlashNotice flash={flash} />

      {status === null ? (
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load your Buffer connection. Try again in a moment.
        </p>
      ) : status.state === 'none' ? (
        <>
          <p className={shell.panelText}>
            Connect your own Buffer account to schedule a draft on LinkedIn. You
            choose the channel and the time and review the exact text first.
            Nothing is scheduled until you press Confirm.
          </p>
          <form action={connectBufferAction}>
            <button type="submit" className="button">
              <Icon name="arrowRight" size={18} />
              Connect Buffer
            </button>
          </form>
        </>
      ) : (
        <>
          <p className={shell.panelText}>
            {status.state === 'connected' ? (
              <strong>Buffer is connected.</strong>
            ) : (
              <strong>Buffer needs to be connected again.</strong>
            )}{' '}
            Shipnote only schedules a post after you review it and press
            Confirm, and you can cancel it until Buffer publishes it.
          </p>
          {status.state === 'needs_reconnect' ? (
            <form action={connectBufferAction}>
              <button type="submit" className="button">
                <Icon name="arrowRight" size={18} />
                Reconnect Buffer
              </button>
            </form>
          ) : null}
          <DisconnectBuffer />
          <SwitchAccountNote />
        </>
      )}
    </section>
  )
}
