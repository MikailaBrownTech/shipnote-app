import 'server-only'
import { countSessions, isSessionActive } from './supabase-admin'

// What src/lib/auth.ts and the sign-out action call. Kept here so code outside
// src/server/ never touches the service role module itself.

export function sessionStillActive(sessionId: string, userId: string) {
  return isSessionActive(sessionId, userId)
}

export function remainingSessions(userId: string) {
  return countSessions(userId)
}
