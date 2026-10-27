import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Seals a user's Buffer tokens before they reach the database, and opens them
// only inside the Buffer client when a call is made.
//
// AES-256-GCM with a random 12-byte nonce for every value. The user id is the
// additional authenticated data, so a sealed value copied to another user's
// row fails to open. A sealed value is base64url(nonce || ciphertext || tag).
//
// Nothing here logs, and errors carry no plaintext, key or sealed text.

const NONCE_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export class VaultError extends Error {
  constructor() {
    super('Token vault: could not open a sealed value')
    this.name = 'VaultError'
  }
}

export type VaultKey = {
  // Stored with the sealed value so the key can be rotated.
  version: number
  key: Buffer
}

// A base64 key must decode to exactly 32 bytes.
export function parseKey(base64: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null
  const key = Buffer.from(base64, 'base64')
  return key.length === KEY_BYTES ? key : null
}

const aad = (userId: string) => Buffer.from(`shipnote:buffer:${userId}`, 'utf8')

export function sealToken(input: {
  plaintext: string
  userId: string
  key: Buffer
}): string {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', input.key, nonce)
  cipher.setAAD(aad(input.userId))
  const body = Buffer.concat([
    cipher.update(input.plaintext, 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url')
}

// Throws VaultError for anything wrong: a tampered value, another user's value,
// the wrong key, or a malformed string. The reason is never given.
export function openToken(input: {
  sealed: string
  userId: string
  key: Buffer
}): string {
  try {
    const raw = Buffer.from(input.sealed, 'base64url')
    if (raw.length < NONCE_BYTES + TAG_BYTES + 1) throw new VaultError()
    const nonce = raw.subarray(0, NONCE_BYTES)
    const tag = raw.subarray(raw.length - TAG_BYTES)
    const body = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', input.key, nonce)
    decipher.setAAD(aad(input.userId))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new VaultError()
  }
}

// Picks the key that sealed a value by its stored version.
export function keyForVersion(
  keys: readonly VaultKey[],
  version: number,
): Buffer | null {
  return keys.find((k) => k.version === version)?.key ?? null
}
