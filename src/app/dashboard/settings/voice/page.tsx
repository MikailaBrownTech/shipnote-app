import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireUser } from '@/lib/auth'
import { buildVoiceSection } from '@/lib/draft-prompt'
import { DEFAULT_VOICE } from '@/lib/voice'
import { aiIsEnabled } from '@/server/draft-generation'
import { readVoice } from '@/server/voice'
import styles from '../../dashboard.module.css'
import { PageIntro } from '../../page-intro'
import projectStyles from '../../projects/projects.module.css'
import { VoiceForm } from './voice-form'
import voiceStyles from './voice.module.css'

export const metadata: Metadata = { title: 'Voice' }

export default function VoicePage() {
  return (
    <main className={styles.main}>
      {/* Reads the session, so it sits behind Suspense. */}
      <Suspense fallback={<p aria-live="polite">Loading your voice</p>}>
        <Voice />
      </Suspense>
    </main>
  )
}

// The proxy also redirects, but this page checks the user itself.
async function Voice() {
  const user = await requireUser()
  const saved = await readVoice(user.id)

  const intro = (
    <PageIntro
      title="Your voice"
      subtitle="Choose how your LinkedIn drafts sound. It applies to drafts you generate and to automatic drafts."
      backHref="/dashboard"
    />
  )

  if (saved === 'failed') {
    return (
      <>
        {intro}
        <p role="alert" className={`on-pink ${projectStyles.notice}`}>
          We could not load your voice settings. Try again in a moment.
        </p>
      </>
    )
  }

  const voice = saved ?? DEFAULT_VOICE
  // About how much text the voice adds to each draft's request.
  const added = buildVoiceSection(voice, '0'.repeat(16))?.length ?? 0

  return (
    <>
      {intro}
      {aiIsEnabled() ? null : (
        <p className={`on-azure ${projectStyles.notice}`}>
          Drafting is switched off right now. You can still save your voice, and
          it will be used when drafting is back.
        </p>
      )}
      {/* The key changes when the stored voice does, so the form starts again
          from what was saved, for example after a reset. */}
      <VoiceForm
        key={JSON.stringify(voice)}
        initial={{
          tone: voice.tone,
          notes: voice.notes,
          samples: voice.samples,
          avoid: voice.avoidWords.join(', '),
          signoff: voice.signoff,
        }}
      />
      <p className={voiceStyles.fine}>
        {added > 0
          ? `Your voice adds about ${added.toLocaleString('en')} characters to each draft's request. `
          : null}
        Shipnote sends your tone, notes, sample posts, words to avoid and
        sign-off to Anthropic when it writes a draft, and nothing else about
        you.
      </p>
    </>
  )
}
