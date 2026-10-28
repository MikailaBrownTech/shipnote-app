'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { describeSecrets } from '@/lib/secret-scan'
import { findVoiceSecrets, normalizeVoice } from '@/lib/voice'
import { parseVoiceForm, type VoiceField } from '@/lib/voice-form'
import { rateLimit } from '@/server/rate-limit'
import { resetVoice, saveVoice } from '@/server/voice'

// Both actions call requireUser() first and act only on the signed-in user's own
// row: there is no user id in the form to trust. Results are fixed codes and
// fixed wording; nothing the user typed is logged or sent back. A soft-deleted
// account has no session, and row-level security refuses it as well.

export type VoiceState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'reset' }
  | { status: 'invalid'; field: VoiceField; message: string }
  // A free-text field looks like it holds a key or a token: nothing is saved.
  | { status: 'secret'; message: string }
  | { status: 'limited' }
  | { status: 'failed' }

const PATH = '/dashboard/settings/voice'

export async function saveVoiceAction(
  _previous: VoiceState,
  form: FormData,
): Promise<VoiceState> {
  const user = await requireUser()

  // An extra brake only; the database enforces every limit itself.
  if (!(await rateLimit('voiceSave', user.id))) return { status: 'limited' }

  const parsed = parseVoiceForm(form)
  if (!parsed.ok) {
    return { status: 'invalid', field: parsed.field, message: parsed.message }
  }
  const voice = normalizeVoice(parsed.voice)

  // Blocked, never masked: a profile that looks like it holds a secret is not
  // saved, and the message names where and what kind, never the text.
  const secrets = findVoiceSecrets(voice)
  const first = secrets.at(0)
  if (first) {
    return {
      status: 'secret',
      message: describeSecrets(first.findings, first.where),
    }
  }

  if ((await saveVoice(user.id, voice)) !== 'ok') return { status: 'failed' }
  revalidatePath(PATH)
  return { status: 'saved' }
}

export async function resetVoiceAction(): Promise<VoiceState> {
  const user = await requireUser()
  if (!(await rateLimit('voiceSave', user.id))) return { status: 'limited' }
  if ((await resetVoice(user.id)) !== 'ok') return { status: 'failed' }
  revalidatePath(PATH)
  return { status: 'reset' }
}
