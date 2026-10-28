import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

// One test for every table and function in the public schema, found from the
// database itself, so a table or function added later cannot skip the check.
//
// Two users each own a row in every table. Then each in turn, as the signed-in
// role, tries to read, change, delete and add rows for the other, and the
// other's rows must come out untouched. Then the attacker's account is soft
// deleted and must see and change nothing at all.
//
// If this fails because a table or function is new, that is the point: add it
// to the lists below and decide, on purpose, who may touch it.

let db: Db

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const SHA = 'a'.repeat(40)
const HASH = 'b'.repeat(64)

beforeAll(async () => {
  db = await createDb()
}, 60_000)

// ---- What is expected, written down so a change has to be a decision ----

// Tables with no user_id column. Each is reached only by the server, never by a
// signed-in user, and the test proves that below.
const NO_USER_COLUMN = new Set(['invites', 'webhook_deliveries'])

// Tables where row-level security is enabled but not forced. Both revoke every
// grant from anon and authenticated and have no policy, so no signed-in role can
// reach them either way. Forcing it would also bind the table owner, which the
// sign-up hook and the invite trigger (both security definer) run as, so it is
// left as shipped. Everything else must be forced.
const NOT_FORCED = new Set(['invites', 'sign_in_events'])

// The only functions a signed-in user may call. Each acts as the caller (or reads
// nothing of anyone's) and is checked below. Trigger functions are not listed:
// PostgreSQL refuses to call them directly.
const SIGNED_IN_MAY_CALL = new Set([
  'buffer_connection_status',
  'is_active_account',
  'mark_draft_copied',
  'voice_list_valid',
])

// Seeds one row for a user in each table. The tables are listed in the order they
// can be filled (a draft needs a project first).
type Ctx = { project: string; draft: string; n: number }
const SEEDS: Record<string, (user: string, ctx: Ctx) => Promise<void>> = {
  projects: async (user, ctx) => {
    const r = await db.query<{ id: string }>(
      `insert into public.projects (user_id, name, stage) values ($1, 'P', 'idea') returning id`,
      [user],
    )
    ctx.project = r.rows[0]?.id ?? ''
  },
  github_installations: async (user, ctx) => {
    await db.query(
      `insert into public.github_installations (user_id, installation_id, account_login, account_id)
       values ($1, $2, 'login', $2)`,
      [user, 1000 + ctx.n],
    )
  },
  drafts: async (user, ctx) => {
    const r = await db.query<{ id: string }>(
      `insert into public.drafts (user_id, project_id, body, model)
       values ($1, $2, 'A private draft', 'm') returning id`,
      [user, ctx.project],
    )
    ctx.draft = r.rows[0]?.id ?? ''
  },
  draft_commits: async (user, ctx) => {
    await db.query(
      `insert into public.draft_commits (draft_id, user_id, commit_sha) values ($1, $2, $3)`,
      [ctx.draft, user, SHA],
    )
  },
  ai_usage: async (user) => {
    await db.query(
      `insert into public.ai_usage (user_id, day, month, status, cost_microusd)
       values ($1, (now() at time zone 'utc')::date,
               date_trunc('month', now() at time zone 'utc')::date, 'completed', 1)`,
      [user],
    )
  },
  buffer_connections: async (user) => {
    await db.query(
      `insert into public.buffer_connections (user_id, access_token_enc, key_version)
       values ($1, 'sealed', 1)`,
      [user],
    )
  },
  scheduled_posts: async (user) => {
    await db.query(
      `insert into public.scheduled_posts (user_id, body, body_hash, channel_id, scheduled_for, status)
       values ($1, 'A private scheduled post', $2, 'c', now() + interval '2 days', 'scheduled')`,
      [user, HASH],
    )
  },
  auto_draft_jobs: async (user, ctx) => {
    await db.query(
      `insert into public.auto_draft_jobs (user_id, project_id, commit_sha) values ($1, $2, $3)`,
      [user, ctx.project, SHA],
    )
  },
  voice_profiles: async (user) => {
    await db.query(
      `insert into public.voice_profiles (user_id, tone, voice_notes) values ($1, 'casual', 'Private notes')`,
      [user],
    )
  },
  sign_in_events: async (user) => {
    await db.query(
      `insert into public.sign_in_events (user_id, method, device_hash) values ($1, 'email', 'dev')`,
      [user],
    )
  },
  invites: async (user, ctx) => {
    await db.query(
      `insert into public.invites (email, used_by) values ($1, $2)`,
      [`invitee${String(ctx.n)}@example.com`, user],
    )
  },
  webhook_deliveries: async (_user, ctx) => {
    await db.query(
      `insert into public.webhook_deliveries (delivery_id, installation_id) values ($1, $2)`,
      [`delivery-${String(ctx.n)}-aaaa`, 1000 + ctx.n],
    )
  },
}

// A valid insert for tables a signed-in user may insert into, owned by `owner`.
// A table that allows inserts but is not listed here fails the test.
const INSERTS: Record<
  string,
  (owner: string) => { text: string; values: unknown[] }
> = {
  projects: (owner) => ({
    text: `insert into public.projects (user_id, name, stage) values ($1, 'Mine', 'idea')`,
    values: [owner],
  }),
  voice_profiles: (owner) => ({
    text: `insert into public.voice_profiles (user_id, tone) values ($1, 'direct')`,
    values: [owner],
  }),
}

// ---- Helpers ----

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

type Table = {
  name: string
  columns: string[]
  rls: boolean
  forced: boolean
  select: boolean
  insert: boolean
  anonAny: boolean
  updatable: string[]
  userIdUpdatable: boolean
}

async function tables(): Promise<Table[]> {
  const found = await db.query<{
    name: string
    rls: boolean
    forced: boolean
  }>(`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`)
  const out: Table[] = []
  for (const row of found.rows) {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [row.name],
    )
    const columns = cols.rows.map((c) => c.column_name)
    // Grants are often per column, which has_table_privilege does not see, so a
    // privilege counts if it is on the table or on any one column.
    const privilege = async (role: string, kind: string) => {
      const r = await db.query<{ ok: boolean }>(
        kind === 'delete'
          ? `select has_table_privilege($1, $2, $3) as ok`
          : `select has_any_column_privilege($1, $2, $3) as ok`,
        [role, `public.${row.name}`, kind],
      )
      return r.rows[0]?.ok ?? false
    }
    const updatable: string[] = []
    for (const column of columns) {
      const r = await db.query<{ ok: boolean }>(
        `select has_column_privilege('authenticated', $1, $2, 'update') as ok`,
        [`public.${row.name}`, column],
      )
      if (r.rows[0]?.ok) updatable.push(column)
    }
    out.push({
      name: row.name,
      columns,
      rls: row.rls,
      forced: row.forced,
      select: await privilege('authenticated', 'select'),
      insert: await privilege('authenticated', 'insert'),
      anonAny:
        (await privilege('anon', 'select')) ||
        (await privilege('anon', 'insert')) ||
        (await privilege('anon', 'update')) ||
        (await privilege('anon', 'delete')),
      updatable,
      userIdUpdatable: updatable.includes('user_id'),
    })
  }
  return out
}

// Resets the data: two users, a row in every table for each.
async function reseed() {
  await db.exec('delete from auth.users;')
  await db.exec('delete from public.webhook_deliveries;')
  await db.exec('delete from public.invites;')
  await db.exec(`
    insert into auth.users (id, email) values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `)
  for (const [user, n] of [
    [A, 1],
    [B, 2],
  ] as const) {
    const ctx: Ctx = { project: '', draft: '', n }
    for (const seed of Object.values(SEEDS)) await seed(user, ctx)
  }
}

// Every row of a user in a table, as text, read as the owner (who sees all).
async function snapshot(table: string, user: string): Promise<string[]> {
  const r = await db.query<{ row: string }>(
    `select to_jsonb(t)::text as row from public.${table} t where t.user_id = $1 order by 1`,
    [user],
  )
  return r.rows.map((x) => x.row)
}

// Runs a statement as the user. 'denied' for a permission or row-level security
// error; otherwise the number of rows it returned.
async function attempt(
  user: string,
  text: string,
  values: unknown[] = [],
): Promise<'denied' | number> {
  try {
    const r = await asUser(user, () => db.query(text, values))
    return r.rows.length
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/permission denied|row-level security|must be owner/i.test(message)) {
      return 'denied'
    }
    throw error
  }
}

const other = (user: string) => (user === A ? B : A)

let all: Table[]

beforeAll(async () => {
  all = await tables()
})

beforeEach(async () => {
  await reseed()
})

// ---- The catalog: nothing new gets in unreviewed ----

describe('every table is accounted for', () => {
  it('there is at least one table, and each has a seed here', () => {
    expect(all.length).toBeGreaterThan(8)
    const names = all.map((t) => t.name).sort()
    expect(
      Object.keys(SEEDS).sort(),
      'A table was added or removed: add or remove its seed in cross-user.test.ts, and decide who may touch it.',
    ).toEqual(names)
  })

  it('row-level security is on for every table, and forced for all but the listed', () => {
    for (const table of all) {
      expect(table.rls, `${table.name} has row-level security off`).toBe(true)
    }
    const notForced = all
      .filter((t) => !t.forced)
      .map((t) => t.name)
      .sort()
    expect(
      notForced,
      'The tables without forced row-level security changed.',
    ).toEqual([...NOT_FORCED].sort())
  })

  it('every table has a user_id, or is one of the two the server alone reaches', () => {
    for (const table of all) {
      const has = table.columns.includes('user_id')
      expect(
        has || NO_USER_COLUMN.has(table.name),
        `${table.name} has no user_id column: whose rows are they? Add one, or list it with a reason.`,
      ).toBe(true)
      if (has) expect(NO_USER_COLUMN.has(table.name)).toBe(false)
    }
  })

  it('anon has no access to any table', () => {
    for (const table of all) {
      expect(table.anonAny, `anon can touch ${table.name}`).toBe(false)
    }
  })

  it('no signed-in user can move a row to another owner: user_id is never updatable', () => {
    for (const table of all) {
      expect(
        table.userIdUpdatable,
        `a signed-in user can change user_id on ${table.name}`,
      ).toBe(false)
    }
  })

  it('a table with no user_id cannot be read or written by a signed-in user at all', async () => {
    for (const table of all.filter((t) => NO_USER_COLUMN.has(t.name))) {
      expect(table.select, `${table.name} is readable`).toBe(false)
      expect(table.insert, `${table.name} is insertable`).toBe(false)
      expect(table.updatable, `${table.name} is updatable`).toEqual([])
      expect(await attempt(A, `select * from public.${table.name}`)).toBe(
        'denied',
      )
    }
  })

  it('every table that allows inserts has a valid insert to attack with', () => {
    const insertable = all
      .filter((t) => t.insert)
      .map((t) => t.name)
      .sort()
    expect(
      Object.keys(INSERTS).sort(),
      'A signed-in user can now insert into a table that is not in INSERTS.',
    ).toEqual(insertable)
  })
})

describe('every function is accounted for', () => {
  type Fn = {
    name: string
    definer: boolean
    fixedPath: boolean
    trigger: boolean
    anon: boolean
    authenticated: boolean
  }

  let functions: Fn[]

  beforeAll(async () => {
    const r = await db.query<Fn>(`
      select p.proname as name, p.prosecdef as definer,
        coalesce(array_to_string(p.proconfig, ';') like '%search_path=%', false) as "fixedPath",
        (p.prorettype = 'trigger'::regtype) as trigger,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`)
    functions = r.rows
  })

  it('there are functions to check', () => {
    expect(functions.length).toBeGreaterThan(20)
  })

  it('every function has a fixed search_path, so none can be hijacked', () => {
    for (const fn of functions) {
      expect(fn.fixedPath, `${fn.name} has no fixed search_path`).toBe(true)
    }
  })

  it('every function that runs with its owner’s rights is closed to anon and to signed-in users, except the reviewed few', () => {
    for (const fn of functions.filter((f) => f.definer)) {
      expect(fn.anon, `anon can call ${fn.name}`).toBe(false)
      expect(
        fn.authenticated,
        `signed-in users can call ${fn.name}: review it, then add it to SIGNED_IN_MAY_CALL`,
      ).toBe(SIGNED_IN_MAY_CALL.has(fn.name))
    }
  })

  it('a signed-in user can call only the reviewed functions (trigger functions cannot be called)', () => {
    const callable = functions
      .filter((f) => f.authenticated && !f.trigger)
      .map((f) => f.name)
      .sort()
    expect(callable).toEqual([...SIGNED_IN_MAY_CALL].sort())
  })

  it('anon can call nothing but trigger functions', () => {
    const callable = functions
      .filter((f) => f.anon && !f.trigger)
      .map((f) => f.name)
    expect(callable).toEqual([])
  })

  it('the functions a signed-in user may call act only as the caller', async () => {
    // A user's own draft is copied; another user's is not found and unchanged.
    const draftB = (
      await db.query<{ id: string }>(
        `select id from public.drafts where user_id = $1`,
        [B],
      )
    ).rows[0]?.id
    const copied = await asUser(A, () =>
      db.query<{ ok: boolean }>(`select public.mark_draft_copied($1) as ok`, [
        draftB,
      ]),
    )
    expect(copied.rows[0]?.ok).toBe(false)
    const status = await db.query<{ status: string; copied_at: string | null }>(
      `select status, copied_at from public.drafts where id = $1`,
      [draftB],
    )
    expect(status.rows[0]).toMatchObject({ status: 'draft', copied_at: null })

    // The Buffer status is the caller's own and nobody else's.
    const own = await asUser(A, () =>
      db.query(`select * from public.buffer_connection_status()`),
    )
    expect(own.rows).toHaveLength(1)

    // Being active is the caller's own account.
    const active = await asUser(A, () =>
      db.query<{ ok: boolean }>(`select public.is_active_account() as ok`),
    )
    expect(active.rows[0]?.ok).toBe(true)
  })

  it('a soft-deleted account is not active, and its Buffer status is empty', async () => {
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    const active = await asUser(A, () =>
      db.query<{ ok: boolean }>(`select public.is_active_account() as ok`),
    )
    expect(active.rows[0]?.ok).toBe(false)
    const status = await asUser(A, () =>
      db.query(`select * from public.buffer_connection_status()`),
    )
    expect(status.rows).toHaveLength(0)
  })
})

// ---- The attack: each user against the other, table by table ----

describe.each([
  ['A against B', A],
  ['B against A', B],
])('a signed-in user cannot reach the other’s rows: %s', (_label, attacker) => {
  const victim = other(attacker)

  it('reads only their own rows in every table they can read', async () => {
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      const result = await attempt(
        attacker,
        `select * from public.${table.name} where user_id = $1`,
        [victim],
      )
      // Nothing of the other's, or no right to read the table at all.
      expect(result, `${attacker} read ${victim}'s ${table.name}`).toBe(
        table.select ? 0 : 'denied',
      )
      if (table.select) {
        const everything = await asUser(attacker, () =>
          db.query<{ user_id: string }>(
            `select user_id from public.${table.name}`,
          ),
        )
        for (const row of everything.rows) expect(row.user_id).toBe(attacker)
      }
    }
  })

  it('their own rows are really there to be read, so the check above means something', async () => {
    const readable = all.filter(
      (t) => t.select && t.columns.includes('user_id'),
    )
    expect(readable.length).toBeGreaterThanOrEqual(5)
    for (const table of readable) {
      const own = await asUser(attacker, () =>
        db.query(`select 1 from public.${table.name} where user_id = $1`, [
          attacker,
        ]),
      )
      expect(
        own.rows.length,
        `${table.name}: no row of their own to read`,
      ).toBeGreaterThan(0)
    }
  })

  it('changes and deletes none of the other’s rows, and leaves every one as it was', async () => {
    const before: Record<string, string[]> = {}
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      before[table.name] = await snapshot(table.name, victim)
    }
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      const column = table.updatable.at(0)
      const update = await attempt(
        attacker,
        column
          ? `update public.${table.name} set ${column} = ${column} where user_id = $1 returning 1`
          : `update public.${table.name} set user_id = user_id where user_id = $1 returning 1`,
        [victim],
      )
      expect(
        update === 'denied' || update === 0,
        `${attacker} updated ${victim}'s ${table.name}`,
      ).toBe(true)
      const remove = await attempt(
        attacker,
        `delete from public.${table.name} where user_id = $1 returning 1`,
        [victim],
      )
      expect(
        remove === 'denied' || remove === 0,
        `${attacker} deleted ${victim}'s ${table.name}`,
      ).toBe(true)
    }
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      expect(
        await snapshot(table.name, victim),
        `${victim}'s rows in ${table.name} changed`,
      ).toEqual(before[table.name])
    }
  })

  it('cannot add a row in the other’s name, in any table that allows inserts', async () => {
    for (const [name, make] of Object.entries(INSERTS)) {
      const sql = make(victim)
      expect(await attempt(attacker, sql.text, sql.values)).toBe('denied')
      // The row did not appear for the victim.
      const count = await db.query<{ n: string }>(
        `select count(*) as n from public.${name} where user_id = $1`,
        [victim],
      )
      expect(Number(count.rows[0]?.n)).toBe(1)
    }
  })

  it('can add a row in their own name, so the check above is not passing by accident', async () => {
    // Make room first: a project and a voice profile already exist for them.
    await db.query(`delete from public.voice_profiles where user_id = $1`, [
      attacker,
    ])
    for (const [name, make] of Object.entries(INSERTS)) {
      const sql = make(attacker)
      expect(await attempt(attacker, sql.text, sql.values), name).toBe(0)
    }
  })

  it('cannot take over another’s row by inserting over it or by moving their own row', async () => {
    const takeover = await attempt(
      attacker,
      `insert into public.voice_profiles (user_id, tone) values ($1, 'humble')
       on conflict (user_id) do update set tone = excluded.tone`,
      [victim],
    )
    expect(takeover).toBe('denied')
    const move = await attempt(
      attacker,
      `update public.voice_profiles set user_id = $1 where user_id = $2`,
      [victim, attacker],
    )
    expect(move).toBe('denied')
    const victimTone = await db.query<{ tone: string }>(
      `select tone from public.voice_profiles where user_id = $1`,
      [victim],
    )
    expect(victimTone.rows[0]?.tone).toBe('casual')
  })
})

describe('anon', () => {
  it('can read, change, delete and add nothing in any table', async () => {
    for (const table of all) {
      for (const text of [
        `select * from public.${table.name}`,
        `update public.${table.name} set ${table.columns[0] ?? 'id'} = ${table.columns[0] ?? 'id'}`,
        `delete from public.${table.name}`,
      ]) {
        await expect(asRole(db, 'anon', () => db.query(text))).rejects.toThrow(
          /permission denied/i,
        )
      }
    }
  })
})

describe('a soft-deleted account', () => {
  it('sees and changes nothing in any table, and adds nothing', async () => {
    const before: Record<string, string[]> = {}
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      before[table.name] = await snapshot(table.name, A)
    }
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)

    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      // Its own rows are hidden...
      const own = await attempt(
        A,
        `select * from public.${table.name} where user_id = $1`,
        [A],
      )
      expect(
        own === 'denied' || own === 0,
        `${table.name} still readable`,
      ).toBe(true)
      // ...and cannot be changed or deleted.
      const column = table.updatable.at(0)
      const update = await attempt(
        A,
        column
          ? `update public.${table.name} set ${column} = ${column} where user_id = $1 returning 1`
          : `update public.${table.name} set user_id = user_id where user_id = $1 returning 1`,
        [A],
      )
      expect(
        update === 'denied' || update === 0,
        `${table.name} still updatable`,
      ).toBe(true)
      const remove = await attempt(
        A,
        `delete from public.${table.name} where user_id = $1 returning 1`,
        [A],
      )
      expect(
        remove === 'denied' || remove === 0,
        `${table.name} still deletable`,
      ).toBe(true)
    }
    for (const [name, make] of Object.entries(INSERTS)) {
      const sql = make(A)
      expect(
        await attempt(A, sql.text, sql.values),
        `${name} still insertable`,
      ).toBe('denied')
    }
    // Nothing was lost along the way: the data is hidden, not gone.
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      expect(await snapshot(table.name, A)).toEqual(before[table.name])
    }
  })

  it('leaves the other user’s access exactly as it was', async () => {
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    for (const table of all.filter(
      (t) => t.select && t.columns.includes('user_id'),
    )) {
      const own = await asUser(B, () =>
        db.query(`select 1 from public.${table.name} where user_id = $1`, [B]),
      )
      expect(own.rows.length, `${table.name}: B lost access`).toBeGreaterThan(0)
    }
  })
})

describe('deleting a user removes their rows everywhere and nobody else’s', () => {
  it('cascades through every table with a user_id', async () => {
    await db.exec(`delete from auth.users where id = '${A}'`)
    for (const table of all.filter((t) => t.columns.includes('user_id'))) {
      expect(
        await snapshot(table.name, A),
        `${table.name} kept A's rows`,
      ).toEqual([])
      expect(
        (await snapshot(table.name, B)).length,
        `${table.name} lost B's rows`,
      ).toBeGreaterThan(0)
    }
  })
})
