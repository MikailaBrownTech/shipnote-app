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

// The only values ?error= may carry on /sign-in. Anything else is ignored.
export const SIGN_IN_ERRORS = [
  'invite',
  'expired',
  'denied',
  'limited',
  'signout',
  'failed',
] as const

export type SignInError = (typeof SIGN_IN_ERRORS)[number]

export function parseSignInError(value: unknown): SignInError | null {
  return SIGN_IN_ERRORS.find((code) => code === value) ?? null
}

// What Supabase puts on the callback URL when the sign-in did not finish.
export function callbackErrorCode(params: URLSearchParams): SignInError {
  const description = params.get('error_description')
  if (isInviteRefusal({ message: description ?? undefined })) return 'invite'
  if (params.get('error_code') === 'otp_expired') return 'expired'
  if (params.get('error') === 'access_denied') return 'denied'
  return 'failed'
}
