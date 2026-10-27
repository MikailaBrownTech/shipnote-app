import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

const USER = '00000000-0000-0000-0000-00000000000a'
const OTHER = '00000000-0000-0000-0000-00000000000b'
const SESSION = '10000000-0000-0000-0000-00000000000a'
const OTHER_SESSION = '10000000-0000-0000-0000-00000000000b'

async function active(session: string, user: string) {
  return asRole(db, 'service_role', async () => {
    const result = await db.query<{ ok: boolean }>(
      'select public.session_is_active($1, $2) as ok',
      [session, user],
    )
    return result.rows[0]?.ok
  })
}

async function count(user: string) {
  return asRole(db, 'service_role', async () => {
    const result = await db.query<{ n: number }>(
      'select public.active_session_count($1) as n',
      [user],
    )
    return result.rows[0]?.n
  })
}

beforeAll(async () => {
  db = await createDb()
}, 60_000)

beforeEach(async () => {
  await db.exec('delete from auth.users; delete from public.invites;')
  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER}', 'a@example.com'), ('${OTHER}', 'b@example.com');
    insert into auth.sessions (id, user_id) values
      ('${SESSION}', '${USER}'), ('${OTHER_SESSION}', '${OTHER}');
  `)
})

describe('session_is_active', () => {
  it('is true for a live session', async () => {
    expect(await active(SESSION, USER)).toBe(true)
  })

  it('is false once the session row is gone (signed out everywhere)', async () => {
    await db.exec(`delete from auth.sessions where user_id = '${USER}'`)
    expect(await active(SESSION, USER)).toBe(false)
  })

  it('is false for a session that belongs to someone else', async () => {
    expect(await active(OTHER_SESSION, USER)).toBe(false)
  })

  it('is false for a session id that never existed', async () => {
    expect(await active('20000000-0000-0000-0000-000000000000', USER)).toBe(
      false,
    )
  })

  it('is false once the session passed its time-box', async () => {
    await db.exec(
      `update auth.sessions set not_after = now() - interval '1 minute' where id = '${SESSION}'`,
    )
    expect(await active(SESSION, USER)).toBe(false)
  })

  it('is false for a soft-deleted account even if a session row remains', async () => {
    await db.exec(
      `update auth.users set deleted_at = now() where id = '${USER}'`,
    )
    expect(await active(SESSION, USER)).toBe(false)
  })

  it.each(['anon', 'authenticated', 'supabase_auth_admin'])(
    '%s cannot call it',
    async (role) => {
      await expect(
        asRole(db, role, () =>
          db.query('select public.session_is_active($1, $2)', [SESSION, USER]),
        ),
      ).rejects.toThrow(/permission denied/i)
    },
  )
})

describe('active_session_count', () => {
  it('counts a user’s sessions and drops to zero after a global sign-out', async () => {
    await db.exec(`insert into auth.sessions (user_id) values ('${USER}')`)
    expect(await count(USER)).toBe(2)
    await db.exec(`delete from auth.sessions where user_id = '${USER}'`)
    expect(await count(USER)).toBe(0)
    expect(await count(OTHER)).toBe(1)
  })

  it.each(['anon', 'authenticated'])('%s cannot call it', async (role) => {
    await expect(
      asRole(db, role, () =>
        db.query('select public.active_session_count($1)', [USER]),
      ),
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('the invite hook and deleted accounts', () => {
  async function hook(email: string) {
    return asRole(db, 'supabase_auth_admin', async () => {
      const result = await db.query<{ r: { error?: { http_code: number } } }>(
        'select public.hook_before_user_created($1::jsonb) as r',
        [
          JSON.stringify({
            user: { email, app_metadata: { provider: 'email' } },
          }),
        ],
      )
      return result.rows[0]?.r ?? {}
    })
  }

  // What Supabase's soft delete leaves behind: the user row stays with
  // deleted_at set and the email scrambled; the invite stays used.
  async function softDelete() {
    await db.exec(`
      insert into public.invites (email, used_at, used_by)
        values ('a@example.com', now(), '${USER}');
      update auth.users
        set deleted_at = now(), email = 'obfuscated-hash'
        where id = '${USER}';
      delete from auth.sessions where user_id = '${USER}';
    `)
  }

  it('refuses the deleted account’s email: the invite stays used', async () => {
    await softDelete()
    expect((await hook('a@example.com')).error?.http_code).toBe(403)
  })

  it('still refuses if used_at was cleared but used_by still points at the deleted user', async () => {
    await softDelete()
    await db.exec('update public.invites set used_at = null')
    expect((await hook('a@example.com')).error?.http_code).toBe(403)
  })

  it('allows a deliberate re-invite (used_at and used_by cleared)', async () => {
    await softDelete()
    await db.exec('update public.invites set used_at = null, used_by = null')
    expect(await hook('a@example.com')).toEqual({})
  })
})
