import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

const USER_A = '00000000-0000-0000-0000-00000000000a'
const USER_B = '00000000-0000-0000-0000-00000000000b'

async function record(
  user: string,
  device: string,
  { allow = true }: { allow?: boolean } = {},
) {
  return asRole(db, 'service_role', async () => {
    const result = await db.query<{ r: { alert: boolean; event_id: string } }>(
      `select public.record_sign_in($1, 'email', '203.0.113.0/24', 'Firefox', $2, $3) as r`,
      [user, device, allow],
    )
    return result.rows[0]?.r ?? { alert: false, event_id: '' }
  })
}

beforeAll(async () => {
  db = await createDb()
}, 60_000)

beforeEach(async () => {
  await db.exec('delete from public.sign_in_events; delete from auth.users;')
  await db.exec(
    `insert into auth.users (id, email) values
       ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com')`,
  )
})

describe('record_sign_in alert decision', () => {
  it('does not alert on a first sign-in', async () => {
    expect((await record(USER_A, 'dev1')).alert).toBe(false)
  })

  it('does not alert on a device it has seen', async () => {
    await record(USER_A, 'dev1')
    expect((await record(USER_A, 'dev1')).alert).toBe(false)
  })

  it('alerts once on a new device', async () => {
    await record(USER_A, 'dev1')
    expect((await record(USER_A, 'dev2')).alert).toBe(true)
  })

  it('sends no second alert within the hour', async () => {
    await record(USER_A, 'dev1')
    expect((await record(USER_A, 'dev2')).alert).toBe(true)
    expect((await record(USER_A, 'dev3')).alert).toBe(false)
  })

  it('alerts again once an hour has passed', async () => {
    await record(USER_A, 'dev1')
    await record(USER_A, 'dev2')
    await db.exec(
      "update public.sign_in_events set alerted_at = now() - interval '61 minutes' where alerted_at is not null",
    )
    expect((await record(USER_A, 'dev3')).alert).toBe(true)
  })

  it('keeps users apart', async () => {
    await record(USER_A, 'dev1')
    await record(USER_B, 'dev1')
    expect((await record(USER_B, 'dev2')).alert).toBe(true)
    expect((await record(USER_A, 'dev2')).alert).toBe(true)
  })

  it('records the event but never claims an alert when alerts are not allowed', async () => {
    await record(USER_A, 'dev1')
    expect((await record(USER_A, 'dev2', { allow: false })).alert).toBe(false)
    // Nothing was claimed, so the next real new device can still alert.
    expect((await record(USER_A, 'dev3')).alert).toBe(true)
  })
})

describe('sign_in_events privileges', () => {
  beforeEach(async () => {
    await record(USER_A, 'dev1')
    await record(USER_B, 'dev1')
  })

  async function asUser<T>(user: string, fn: () => Promise<T>) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      user,
    ])
    try {
      return await asRole(db, 'authenticated', fn)
    } finally {
      await db.query("select set_config('request.jwt.claim.sub', '', false)")
    }
  }

  it('lets a user read only their own rows', async () => {
    const rows = await asUser(USER_A, () =>
      db.query<{ user_id: string }>(
        'select user_id from public.sign_in_events',
      ),
    )
    expect(rows.rows.map((row) => row.user_id)).toEqual([USER_A])
  })

  it('hides a soft-deleted account’s events from it, and keeps them for the purge', async () => {
    await db.exec(
      `update auth.users set deleted_at = now() where id = '${USER_A}'`,
    )
    const rows = await asUser(USER_A, () =>
      db.query('select user_id from public.sign_in_events'),
    )
    expect(rows.rows).toHaveLength(0)
    // Hidden, not gone: the data is still there for the purge job.
    const kept = await db.query(
      'select 1 from public.sign_in_events where user_id = $1',
      [USER_A],
    )
    expect(kept.rows.length).toBeGreaterThan(0)
  })

  it('does not let a user insert, update or delete', async () => {
    await expect(
      asUser(USER_A, () =>
        db.query(
          `insert into public.sign_in_events (user_id, method, device_hash) values ('${USER_A}', 'email', 'x')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      asUser(USER_A, () =>
        db.query('update public.sign_in_events set method = $1', ['github']),
      ),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      asUser(USER_A, () => db.query('delete from public.sign_in_events')),
    ).rejects.toThrow(/permission denied/i)
  })

  it('does not let anon read anything', async () => {
    await expect(
      asRole(db, 'anon', () => db.query('select * from public.sign_in_events')),
    ).rejects.toThrow(/permission denied/i)
  })

  it.each(['anon', 'authenticated'])(
    '%s cannot call record_sign_in',
    async (role) => {
      await expect(
        asRole(db, role, () =>
          db.query(
            `select public.record_sign_in('${USER_A}', 'email', null, null, 'x', true)`,
          ),
        ),
      ).rejects.toThrow(/permission denied/i)
    },
  )

  it('removes events when the user is deleted', async () => {
    await db.exec(`delete from auth.users where id = '${USER_A}'`)
    const rows = await db.query(
      'select 1 from public.sign_in_events where user_id = $1',
      [USER_A],
    )
    expect(rows.rows).toHaveLength(0)
  })
})
