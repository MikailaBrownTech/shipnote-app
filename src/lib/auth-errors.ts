// The before-user-created hook rejects uninvited sign-ups with a message
// containing this marker (see supabase/migrations). Supabase passes the
// message back to the client, so it is the only way to tell that refusal from
// other failures. Unverified against a live project (see the README).
export const INVITE_ONLY_MARKER = 'invite only'

export function isInviteRefusal(
  error: { message?: string } | null | undefined,
): boolean {
  return Boolean(error?.message?.toLowerCase().includes(INVITE_ONLY_MARKER))
}
