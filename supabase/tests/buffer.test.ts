import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const HASH = 'a'.repeat(64)
const SECRET_A = 'ciphertext-of-user-a-token'

beforeAll(async () => {
  db = await createDb()
}, 60_000)

let draftA = ''
let draftB = ''

beforeEach(async () => {
  await db.exec('delete from auth.users;')
  await db.exec(`
    insert into auth.users (id, email) values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `)
  draftA = await draft(A)
  draftB = await draft(B)
})

async function draft(user: string) {
  const project = await db.query<{ id: string }>(
    `insert into public.projects (user_id, name, stage)
     values ($1, 'P', 'idea') returning id`,
    [user],
  )
  const usage = await db.query<{ id: string }>(
    'select public.reserve_generation($1, 1000, 10, 10000000) as id',
    [user],
  )
  const made = await db.query<{ id: string }>(
    `select public.complete_generation($1, $2, $3, 'A draft.', 'claude-sonnet-5-5', 1, 1, 1, $4) as id`,
    [usage.rows[0]?.id, user, project.rows[0]?.id, []],
  )
  return made.rows[0]?.id ?? ''
}

async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    user,
  ])
  try {
    return await asRole(db, 'authenticated', fn)
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
  }
}

const service = <T>(fn: () => Promise<T>) => asRole(db, 'service_role', fn)

const inHours = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString()

function connect(user: string, access = SECRET_A) {
  return service(() =>
    db.query<{ id: string }>(
      `select public.save_buffer_connection($1, $2, 'refresh-enc', 1, $3, 'posts:write', 'org-1') as id`,
      [user, access, inHours(1)],
    ),
  )
}

function schedule(
  user: string,
  draftId: string,
  over: { body?: string; hash?: string; at?: string; daily?: number } = {},
) {
  return service(() =>
    db.query<{ id: string }>(
      `select public.create_scheduled_post($1, $2, $3, $4, 'chan-1', 'My LinkedIn', $5, $6) as id`,
      [
        user,
        draftId,
        over.body ?? 'The exact text',
        over.hash ?? HASH,
        over.at ?? inHours(48),
        over.daily ?? 5,
      ],
    ),
  )
}

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toThrow(/permission denied|must be owner|row-level/i)

describe('buffer_connections: tokens are unreadable by every user role', () => {
  beforeEach(async () => {
    await connect(A)
  })

  it.each(['authenticated', 'anon'])(
    '%s cannot select, insert, update or delete it',
    async (role) => {
      const run = (sql: string) => asRole(db, role, () => db.query(sql))
      await denied(run('select * from public.buffer_connections'))
      await denied(
        run('select access_token_enc from public.buffer_connections'),
      )
      await denied(run('select count(*) from public.buffer_connections'))
      await denied(
        run(
          `insert into public.buffer_connections (user_id, access_token_enc, key_version)
           values ('${B}', 'x', 1)`,
        ),
      )
      await denied(
        run("update public.buffer_connections set status = 'connected'"),
      )
      await denied(run('delete from public.buffer_connections'))
    },
  )

  it('is protected even for a table owner’s policies: forced RLS with no policy', async () => {
    const flags = await db.query<{
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.buffer_connections'::regclass",
    )
    expect(flags.rows[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
    })
    const policies = await db.query(
      "select 1 from pg_policies where tablename = 'buffer_connections'",
    )
    expect(policies.rows).toEqual([])
  })

  it('the status function shows the caller only state and time, never a token', async () => {
    const result = await asUser(A, () =>
      db.query<Record<string, unknown>>(
        'select * from public.buffer_connection_status()',
      ),
    )
    expect(result.rows).toHaveLength(1)
    expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual([
      'connected_at',
      'status',
    ])
    expect(JSON.stringify(result.rows)).not.toContain(SECRET_A)
    expect(result.rows[0]?.status).toBe('connected')
  })

  it('the status function says nothing about another user, and nothing for none', async () => {
    const asB = await asUser(B, () =>
      db.query('select * from public.buffer_connection_status()'),
    )
    expect(asB.rows).toEqual([])
  })

  it('anon cannot call the status function', async () => {
    await denied(
      asRole(db, 'anon', () =>
        db.query('select * from public.buffer_connection_status()'),
      ),
    )
  })

  it.each([
    "select * from public.read_buffer_connection('" + A + "')",
    "select public.save_buffer_connection('" +
      A +
      "', 'x', null, 1, null, null, null)",
    "select public.update_buffer_tokens('" + A + "', 'x', null, 1, null)",
    "select public.mark_buffer_needs_reconnect('" + A + "')",
    "select public.delete_buffer_connection('" + A + "')",
    "select public.account_active('" + A + "')",
  ])('no user role can call: %s', async (sql) => {
    await denied(asUser(A, () => db.query(sql)))
    await denied(asRole(db, 'anon', () => db.query(sql)))
  })

  it('the service role reads the ciphertext it stored', async () => {
    const read = await service(() =>
      db.query<{
        access_token_enc: string
        key_version: number
        organization_id: string
      }>(`select * from public.read_buffer_connection('${A}')`),
    )
    expect(read.rows[0]).toMatchObject({
      access_token_enc: SECRET_A,
      key_version: 1,
      organization_id: 'org-1',
    })
  })

  it('reading one user returns only that user’s row', async () => {
    await connect(B, 'ciphertext-of-user-b')
    const read = await service(() =>
      db.query<{ access_token_enc: string }>(
        `select access_token_enc from public.read_buffer_connection('${A}')`,
      ),
    )
    expect(read.rows).toEqual([{ access_token_enc: SECRET_A }])
  })

  it('saving again replaces the row: one connection per user', async () => {
    await connect(A, 'newer-ciphertext')
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.buffer_connections where user_id = '${A}'`,
    )
    expect(count.rows[0]?.n).toBe(1)
    const read = await service(() =>
      db.query<{ access_token_enc: string }>(
        `select access_token_enc from public.read_buffer_connection('${A}')`,
      ),
    )
    expect(read.rows[0]?.access_token_enc).toBe('newer-ciphertext')
  })

  it('a refresh updates the tokens, and needs_reconnect then connected again', async () => {
    await service(() =>
      db.query(`select public.mark_buffer_needs_reconnect('${A}')`),
    )
    const state = () =>
      service(() =>
        db.query<{ status: string }>(
          `select status from public.read_buffer_connection('${A}')`,
        ),
      )
    expect((await state()).rows[0]?.status).toBe('needs_reconnect')
    await service(() =>
      db.query(
        `select public.update_buffer_tokens('${A}', 'refreshed', 'r2', 2, now() + interval '1 hour')`,
      ),
    )
    expect((await state()).rows[0]?.status).toBe('connected')
  })

  it('a refresh for a user with no connection changes nothing', async () => {
    const result = await service(() =>
      db.query<{ ok: boolean }>(
        `select public.update_buffer_tokens('${B}', 'x', null, 1, null) as ok`,
      ),
    )
    expect(result.rows[0]?.ok).toBe(false)
  })

  it('rejects an empty token or a bad key version', async () => {
    await expect(
      service(() =>
        db.query(
          `select public.save_buffer_connection('${B}', '', null, 1, null, null, null)`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'SN022' })
    await expect(
      service(() =>
        db.query(
          `select public.save_buffer_connection('${B}', 'x', null, 0, null, null, null)`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'SN022' })
  })

  it('delete removes only that user’s tokens', async () => {
    await connect(B, 'ciphertext-of-user-b')
    await service(() =>
      db.query(`select public.delete_buffer_connection('${A}')`),
    )
    const left = await db.query<{ user_id: string }>(
      'select user_id from public.buffer_connections',
    )
    expect(left.rows).toEqual([{ user_id: B }])
  })
})

describe('soft-deleted accounts', () => {
  it('cannot connect, and their stored token cannot be read back', async () => {
    await connect(A)
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    const read = await service(() =>
      db.query(`select * from public.read_buffer_connection('${A}')`),
    )
    expect(read.rows).toEqual([])
    await expect(connect(A, 'again')).rejects.toMatchObject({ code: 'SN024' })
    const status = await asUser(A, () =>
      db.query('select * from public.buffer_connection_status()'),
    )
    expect(status.rows).toEqual([])
  })

  it('cannot schedule, and see no schedules', async () => {
    const id = (await schedule(A, draftA)).rows[0]?.id
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    expect(id).toBeTruthy()
    await expect(schedule(A, draftA)).rejects.toMatchObject({ code: 'SN024' })
    const seen = await asUser(A, () =>
      db.query('select * from public.scheduled_posts'),
    )
    expect(seen.rows).toEqual([])
  })

  it('cleanup on deletion still works: tokens deleted and schedules ended', async () => {
    await connect(A)
    const id = (await schedule(A, draftA)).rows[0]?.id
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    await service(() =>
      db.query(`select public.delete_buffer_connection('${A}')`),
    )
    const ended = await service(() =>
      db.query<{ ok: boolean }>(
        `select public.finish_scheduled_post('${id}', '${A}', 'canceled', null) as ok`,
      ),
    )
    expect(ended.rows[0]?.ok).toBe(true)
    const left = await db.query('select 1 from public.buffer_connections')
    expect(left.rows).toEqual([])
  })
})

describe('anon', () => {
  it('sees and changes nothing', async () => {
    await connect(A)
    await schedule(A, draftA)
    await denied(
      asRole(db, 'anon', () =>
        db.query('select * from public.scheduled_posts'),
      ),
    )
    await denied(
      asRole(db, 'anon', () =>
        db.query('select * from public.buffer_connections'),
      ),
    )
  })
})

describe('scheduled_posts: who can see and change rows', () => {
  it('a user reads only their own schedules', async () => {
    const a = (await schedule(A, draftA)).rows[0]?.id
    await schedule(B, draftB)
    const rows = await asUser(A, async () => {
      const result = await db.query<{ id: string }>(
        'select id from public.scheduled_posts',
      )
      return result.rows
    })
    expect(rows).toEqual([{ id: a }])
  })

  it('a user cannot insert, update or delete schedules, even their own', async () => {
    const a = (await schedule(A, draftA)).rows[0]?.id
    await denied(
      asUser(A, () =>
        db.query(
          `insert into public.scheduled_posts (user_id, body, body_hash, channel_id, scheduled_for, status)
           values ('${A}', 'x', '${HASH}', 'c', now() + interval '2 days', 'scheduled')`,
        ),
      ),
    )
    await denied(
      asUser(A, () =>
        db.query("update public.scheduled_posts set body = 'changed'"),
      ),
    )
    await denied(
      asUser(A, () => db.query('delete from public.scheduled_posts')),
    )
    const body = await db.query<{ body: string }>(
      'select body from public.scheduled_posts where id = $1',
      [a],
    )
    expect(body.rows[0]?.body).toBe('The exact text')
  })

  it('cannot schedule another user’s draft', async () => {
    await expect(schedule(A, draftB)).rejects.toMatchObject({ code: 'SN023' })
    const none = await db.query('select 1 from public.scheduled_posts')
    expect(none.rows).toEqual([])
  })

  it('the service functions never cross users', async () => {
    const a = (await schedule(A, draftA)).rows[0]?.id
    const wrong = await service(() =>
      db.query<{ ok: boolean }>(
        `select public.mark_post_scheduled('${a}', '${B}', 'bp-1') as ok`,
      ),
    )
    expect(wrong.rows[0]?.ok).toBe(false)
    const wrongFinish = await service(() =>
      db.query<{ ok: boolean }>(
        `select public.finish_scheduled_post('${a}', '${B}', 'canceled', null) as ok`,
      ),
    )
    expect(wrongFinish.rows[0]?.ok).toBe(false)
    const state = await db.query<{ status: string }>(
      'select status from public.scheduled_posts where id = $1',
      [a],
    )
    expect(state.rows[0]?.status).toBe('scheduling')
  })
})

describe('scheduling rules', () => {
  it('stores the exact snapshot and starts as scheduling', async () => {
    const id = (await schedule(A, draftA, { body: 'Exact  text\nwith lines' }))
      .rows[0]?.id
    const row = await db.query<Record<string, unknown>>(
      'select body, body_hash, channel_id, channel_label, status, buffer_post_id from public.scheduled_posts where id = $1',
      [id],
    )
    expect(row.rows[0]).toEqual({
      body: 'Exact  text\nwith lines',
      body_hash: HASH,
      channel_id: 'chan-1',
      channel_label: 'My LinkedIn',
      status: 'scheduling',
      buffer_post_id: null,
    })
  })

  it('one draft has at most one active schedule', async () => {
    await schedule(A, draftA)
    await expect(schedule(A, draftA)).rejects.toMatchObject({ code: 'SN021' })
  })

  it('the unique index holds even without the function’s check', async () => {
    await schedule(A, draftA)
    await expect(
      db.query(
        `insert into public.scheduled_posts (user_id, draft_id, body, body_hash, channel_id, scheduled_for, status)
         values ('${A}', '${draftA}', 'x', '${HASH}', 'c', now() + interval '2 days', 'scheduled')`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('a burst of requests for the same draft creates exactly one schedule', async () => {
    // PGlite is one connection, so this is a serialized burst; real parallel
    // locking is not proven here (see the README).
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => schedule(A, draftA)),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rows = await db.query('select 1 from public.scheduled_posts')
    expect(rows.rows).toHaveLength(1)
  })

  it('a canceled or failed schedule frees the draft for a new one', async () => {
    const first = (await schedule(A, draftA)).rows[0]?.id
    await service(() =>
      db.query(
        `select public.finish_scheduled_post('${first}', '${A}', 'canceled', null)`,
      ),
    )
    await expect(schedule(A, draftA)).resolves.toBeDefined()
  })

  it('refuses a time in the past, too far ahead, or missing', async () => {
    await expect(
      schedule(A, draftA, { at: inHours(-1) }),
    ).rejects.toMatchObject({ code: 'SN022' })
    await expect(
      schedule(A, draftA, { at: inHours(24 * 32) }),
    ).rejects.toMatchObject({ code: 'SN022' })
  })

  it('refuses an empty or oversized text and a malformed hash', async () => {
    await expect(schedule(A, draftA, { body: '' })).rejects.toMatchObject({
      code: 'SN022',
    })
    await expect(
      schedule(A, draftA, { body: 'x'.repeat(3001) }),
    ).rejects.toMatchObject({ code: 'SN022' })
    await expect(schedule(A, draftA, { hash: 'nothex' })).rejects.toMatchObject(
      { code: 'SN022' },
    )
  })

  it('allows only the daily number of new schedules, counting failed ones', async () => {
    const drafts = [draftA]
    for (let i = 0; i < 2; i++) drafts.push(await draft(A))
    const first = (await schedule(A, drafts[0] ?? '', { daily: 2 })).rows[0]?.id
    await service(() =>
      db.query(
        `select public.finish_scheduled_post('${first}', '${A}', 'failed', 'unknown_result')`,
      ),
    )
    await schedule(A, drafts[1] ?? '', { daily: 2 })
    await expect(
      schedule(A, drafts[2] ?? '', { daily: 2 }),
    ).rejects.toMatchObject({ code: 'SN020' })
  })

  it('the daily number is per user', async () => {
    await schedule(A, draftA, { daily: 1 })
    await expect(schedule(B, draftB, { daily: 1 })).resolves.toBeDefined()
  })
})

describe('status changes', () => {
  async function scheduled() {
    const id = (await schedule(A, draftA)).rows[0]?.id ?? ''
    await service(() =>
      db.query(`select public.mark_post_scheduled('${id}', '${A}', 'bp-1')`),
    )
    return id
  }
  const row = (id: string) =>
    db.query<{
      status: string
      buffer_post_id: string | null
      canceled_at: string | null
      failure_code: string | null
    }>(
      'select status, buffer_post_id, canceled_at, failure_code from public.scheduled_posts where id = $1',
      [id],
    )

  it('scheduling becomes scheduled with the Buffer post id, once', async () => {
    const id = await scheduled()
    expect((await row(id)).rows[0]).toMatchObject({
      status: 'scheduled',
      buffer_post_id: 'bp-1',
    })
    const again = await service(() =>
      db.query<{ ok: boolean }>(
        `select public.mark_post_scheduled('${id}', '${A}', 'bp-2') as ok`,
      ),
    )
    expect(again.rows[0]?.ok).toBe(false)
    expect((await row(id)).rows[0]?.buffer_post_id).toBe('bp-1')
  })

  it('cancel sets the time; a canceled post cannot be changed again', async () => {
    const id = await scheduled()
    await service(() =>
      db.query(
        `select public.finish_scheduled_post('${id}', '${A}', 'canceled', null)`,
      ),
    )
    const after = (await row(id)).rows[0]
    expect(after?.status).toBe('canceled')
    expect(after?.canceled_at).not.toBeNull()
    for (const next of ['published', 'failed', 'canceled']) {
      const again = await service(() =>
        db.query<{ ok: boolean }>(
          `select public.finish_scheduled_post('${id}', '${A}', '${next}', 'x') as ok`,
        ),
      )
      expect(again.rows[0]?.ok).toBe(false)
    }
  })

  it('a scheduled post can be marked published; a scheduling one cannot', async () => {
    const pending = (await schedule(A, draftA)).rows[0]?.id ?? ''
    const early = await service(() =>
      db.query<{ ok: boolean }>(
        `select public.finish_scheduled_post('${pending}', '${A}', 'published', null) as ok`,
      ),
    )
    expect(early.rows[0]?.ok).toBe(false)
    await service(() =>
      db.query(
        `select public.mark_post_scheduled('${pending}', '${A}', 'bp-1')`,
      ),
    )
    await service(() =>
      db.query(
        `select public.finish_scheduled_post('${pending}', '${A}', 'published', null)`,
      ),
    )
    expect((await row(pending)).rows[0]?.status).toBe('published')
  })

  it('failed keeps only a short code', async () => {
    const id = (await schedule(A, draftA)).rows[0]?.id ?? ''
    await service(() =>
      db.query(
        `select public.finish_scheduled_post('${id}', '${A}', 'failed', '${'x'.repeat(100)}')`,
      ),
    )
    expect((await row(id)).rows[0]?.failure_code).toHaveLength(40)
  })

  it('refuses an unknown status', async () => {
    const id = (await schedule(A, draftA)).rows[0]?.id ?? ''
    await expect(
      service(() =>
        db.query(
          `select public.finish_scheduled_post('${id}', '${A}', 'scheduled', null)`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'SN022' })
  })
})

describe('deleting things', () => {
  it('deleting a draft keeps the schedule so it can still be cancelled', async () => {
    const id = (await schedule(A, draftA)).rows[0]?.id ?? ''
    await db.query('delete from public.drafts where id = $1', [draftA])
    const row = await db.query<{
      draft_id: string | null
      user_id: string
      body: string
    }>(
      'select draft_id, user_id, body from public.scheduled_posts where id = $1',
      [id],
    )
    expect(row.rows[0]).toEqual({
      draft_id: null,
      user_id: A,
      body: 'The exact text',
    })
  })

  it('deleting a user removes their connection and schedules, and no one else’s', async () => {
    await connect(A)
    await connect(B, 'ciphertext-of-user-b')
    await schedule(A, draftA)
    await schedule(B, draftB)
    await db.exec(`delete from auth.users where id = '${A}'`)
    const connections = await db.query<{ user_id: string }>(
      'select user_id from public.buffer_connections',
    )
    const posts = await db.query<{ user_id: string }>(
      'select user_id from public.scheduled_posts',
    )
    expect(connections.rows).toEqual([{ user_id: B }])
    expect(posts.rows).toEqual([{ user_id: B }])
  })
})
