import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'

const root = join(import.meta.dirname, '..')

// A fresh in-memory Postgres with the Supabase stub and every migration.
export async function createDb() {
  const db = new PGlite({ extensions: { citext } })
  await db.exec(readFileSync(join(root, 'tests', 'supabase-stub.sql'), 'utf8'))
  await db.exec('create extension citext with schema extensions')

  const files = readdirSync(join(root, 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(root, 'migrations', file), 'utf8'))
  }
  return db
}

export type Db = Awaited<ReturnType<typeof createDb>>

// Runs `fn` with the session role switched, then switches back.
export async function asRole<T>(
  db: Db,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}
