// The only values ?buffer= may carry on a page. The page shows fixed wording for
// a known code and ignores anything else, so nothing in the URL is ever echoed
// back. No imports.
export const BUFFER_FLASH = [
  'connected',
  'expired', // the connect attempt timed out, was reused, or did not start here
  'denied', // Buffer refused, or the person did not allow access
  'no_organization',
  'rate_limited',
  'limited',
  'unavailable',
  'failed',
  'disconnected',
  'disconnected_posts', // disconnected, but some scheduled posts may still publish
] as const

export type BufferFlash = (typeof BUFFER_FLASH)[number]

export function parseBufferFlash(value: unknown): BufferFlash | null {
  return BUFFER_FLASH.find((code) => code === value) ?? null
}

export const BUFFER_REVOKE_NOTE =
  'Buffer has no way for Shipnote to revoke access, so also remove Shipnote from the connected apps in your Buffer account settings.'

export const BUFFER_FLASH_MESSAGES: Record<
  BufferFlash,
  { tone: 'good' | 'bad'; text: string }
> = {
  connected: { tone: 'good', text: 'Buffer connected.' },
  expired: {
    tone: 'bad',
    text: 'That connection attempt expired or was already used. Nothing was saved. Start again.',
  },
  denied: {
    tone: 'bad',
    text: 'Buffer did not give us access. Nothing was saved. Try again.',
  },
  no_organization: {
    tone: 'bad',
    text: 'We could not find a Buffer organization on that account, so nothing was saved.',
  },
  rate_limited: {
    tone: 'bad',
    text: 'Buffer is limiting requests right now. Try again in a few minutes.',
  },
  limited: {
    tone: 'bad',
    text: 'Too many attempts. Try again in a few minutes.',
  },
  unavailable: {
    tone: 'bad',
    text: 'Buffer is not responding right now. Nothing was saved. Try again in a moment.',
  },
  failed: { tone: 'bad', text: 'Something went wrong. Nothing was saved.' },
  disconnected: {
    tone: 'good',
    text: `Buffer disconnected from Shipnote. ${BUFFER_REVOKE_NOTE}`,
  },
  disconnected_posts: {
    tone: 'bad',
    text: `Buffer disconnected from Shipnote, but some scheduled posts could not be cancelled and may still publish. Cancel them in Buffer. ${BUFFER_REVOKE_NOTE}`,
  },
}

// A same-site path with ?buffer=<code> added.
export function withBufferFlash(path: string, code: BufferFlash): string {
  const url = new URL(path, 'http://shipnote.invalid')
  url.searchParams.set('buffer', code)
  return `${url.pathname}${url.search}`
}
