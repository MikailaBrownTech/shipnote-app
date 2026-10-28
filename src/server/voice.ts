import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { normalizeVoice, type VoiceProfile } from '@/lib/voice'
import { TONE_IDS } from '@/lib/voice-tones'

// A user's own voice profile, read and written with their own session, so
// row-level security decides what they can touch: another user's row is simply
// not there. Nothing here logs a value (not the notes, the samples or the
// sign-off); a failure is a plain result and only the database error code is
// logged.

const COLUMNS = 'tone, voice_notes, sample_posts, avoid_words, signoff'

const row = z.object({
  tone: z.enum(TONE_IDS),
  voice_notes: z.string(),
  sample_posts: z.array(z.string()),
  avoid_words: z.array(z.string()),
  signoff: z.string(),
})

function note(code: string | undefined) {
  console.warn('voice: query failed', code ?? 'unknown')
}

function toVoice(r: z.infer<typeof row>): VoiceProfile {
  return normalizeVoice({
    tone: r.tone,
    notes: r.voice_notes,
    samples: r.sample_posts,
    avoidWords: r.avoid_words,
    signoff: r.signoff,
  })
}

// The user's saved voice, null if they have none, 'failed' if it could not be
// read (the caller must not quietly fall back to another voice).
export async function readVoice(
  userId: string,
): Promise<VoiceProfile | null | 'failed'> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('voice_profiles')
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    note(error.code)
    return 'failed'
  }
  if (data === null) return null
  const parsed = row.safeParse(data)
  return parsed.success ? toVoice(parsed.data) : 'failed'
}

function columns(voice: VoiceProfile) {
  return {
    tone: voice.tone,
    voice_notes: voice.notes,
    sample_posts: voice.samples,
    avoid_words: voice.avoidWords,
    signoff: voice.signoff,
  }
}

// Saves the user's voice: change their row, or make it if there is none yet.
// (An upsert would also try to set user_id, which a user may not change.)
export async function saveVoice(
  userId: string,
  voice: VoiceProfile,
): Promise<'ok' | 'failed'> {
  const supabase = await createClient()
  const update = () =>
    supabase
      .from('voice_profiles')
      .update(columns(voice))
      .eq('user_id', userId)
      .select('user_id')

  const first = await update()
  if (first.error) {
    note(first.error.code)
    return 'failed'
  }
  if (first.data.length > 0) return 'ok'

  const insert = await supabase
    .from('voice_profiles')
    .insert({ user_id: userId, ...columns(voice) })
  if (!insert.error) return 'ok'
  // Another request made the row first: change it instead.
  if (insert.error.code === '23505') {
    const second = await update()
    if (second.error) {
      note(second.error.code)
      return 'failed'
    }
    return second.data.length > 0 ? 'ok' : 'failed'
  }
  note(insert.error.code)
  return 'failed'
}

// Back to the default: the row is deleted.
export async function resetVoice(userId: string): Promise<'ok' | 'failed'> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('voice_profiles')
    .delete()
    .eq('user_id', userId)
  if (error) {
    note(error.code)
    return 'failed'
  }
  return 'ok'
}
