import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

beforeAll(async () => {
  db = await createDb()
}, 60_000)

let projectA = ''
let projectB = ''

beforeEach(async () => {
  await db.exec('delete from auth.users;')
  await db.exec(`
    insert into auth.users (id, email) values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `)
  projectA = await project(A)
  projectB = await project(B)
})

async function project(user: string) {
  const result = await db.query<{ id: string }>(
    `insert into public.projects (user_id, name, stage)
     values ($1, 'P', 'idea') returning id`,
    [user],
  )
  return result.rows[0]?.id ?? ''
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

// reserve -> complete, the way the server does it.
async function reserve(
  user: string,
  estimate = 1000,
  daily = 10,
  cap = 10_000_000,
) {
  const result = await service(() =>
    db.query<{ id: string }>(
      'select public.reserve_generation($1, $2, $3, $4) as id',
      [user, estimate, daily, cap],
    ),
  )
  return result.rows[0]?.id ?? ''
}

async function complete(
  usage: string,
  user: string,
  projectId: string,
  over: { body?: string; cost?: number; shas?: string[] } = {},
) {
  const result = await service(() =>
    db.query<{ id: string }>(
      `select public.complete_generation($1, $2, $3, $4, 'claude-sonnet-5-5', 300, 200, $5, $6) as id`,
      [
        usage,
        user,
        projectId,
        over.body ?? 'A draft.',
        over.cost ?? 2300,
        over.shas ?? [SHA1],
      ],
    ),
  )
  return result.rows[0]?.id ?? ''
}

async function draftFor(user: string, projectId: string, shas = [SHA1]) {
  return complete(await reserve(user), user, projectId, { shas })
}

describe('drafts: who can see and change rows', () => {
  it('a user reads only their own drafts and commit links', async () => {
    const a = await draftFor(A, projectA)
    await draftFor(B, projectB, [SHA2])
    const drafts = await asUser(A, async () => {
      const result = await db.query<{ id: string }>(
        'select id from public.drafts',
      )
      return result.rows
    })
    expect(drafts).toEqual([{ id: a }])
    const links = await asUser(A, async () => {
      const result = await db.query<{ commit_sha: string }>(
        'select commit_sha from public.draft_commits',
      )
      return result.rows
    })
    expect(links).toEqual([{ commit_sha: SHA1 }])
  })

  it('cannot read, update or delete another user’s draft', async () => {
    const b = await draftFor(B, projectB)
    const read = await asUser(A, async () => {
      const result = await db.query(
        'select * from public.drafts where id = $1',
        [b],
      )
      return result.rows
    })
    expect(read).toEqual([])
    const updated = await asUser(A, () =>
      db.query("update public.drafts set body = 'hijacked' where id = $1", [b]),
    )
    expect(updated.affectedRows).toBe(0)
    const deleted = await asUser(A, () =>
      db.query('delete from public.drafts where id = $1', [b]),
    )
    expect(deleted.affectedRows).toBe(0)
    const still = await db.query<{ body: string }>(
      'select body from public.drafts where id = $1',
      [b],
    )
    expect(still.rows[0]?.body).toBe('A draft.')
  })

  it('cannot read or change another user’s commit links', async () => {
    await draftFor(B, projectB, [SHA2])
    const rows = await asUser(A, async () => {
      const result = await db.query('select * from public.draft_commits')
      return result.rows
    })
    expect(rows).toEqual([])
    await expect(
      asUser(A, () => db.query('delete from public.draft_commits')),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot insert a draft or a commit link, even for themselves', async () => {
    await expect(
      asUser(A, () =>
        db.query(
          `insert into public.drafts (user_id, project_id, body, model)
           values ($1, $2, 'x', 'm')`,
          [A, projectA],
        ),
      ),
    ).rejects.toThrow(/permission denied/)
    const draft = await draftFor(A, projectA)
    await expect(
      asUser(A, () =>
        db.query(
          `insert into public.draft_commits (draft_id, user_id, commit_sha)
           values ($1, $2, $3)`,
          [draft, A, SHA2],
        ),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot create a draft for another user’s project', async () => {
    const usage = await reserve(A)
    await expect(complete(usage, A, projectB)).rejects.toThrow(/foreign key/)
    const rows = await db.query('select * from public.drafts')
    expect(rows.rows).toEqual([])
  })

  it('may change only the body and the copy fields', async () => {
    const id = await draftFor(A, projectA)
    const edited = await asUser(A, () =>
      db.query("update public.drafts set body = 'My edit' where id = $1", [id]),
    )
    expect(edited.affectedRows).toBe(1)
    for (const column of [
      'user_id',
      'project_id',
      'model',
      'input_tokens',
      'output_tokens',
      'cost_microusd',
      'created_at',
      'id',
    ]) {
      await expect(
        asUser(A, () =>
          db.query(
            `update public.drafts set ${column} = ${column} where id = $1`,
            [id],
          ),
        ),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('the body is limited to 1 to 3,000 characters, on an edit too', async () => {
    const id = await draftFor(A, projectA)
    for (const body of ['', 'x'.repeat(3001)]) {
      await expect(
        asUser(A, () =>
          db.query('update public.drafts set body = $2 where id = $1', [
            id,
            body,
          ]),
        ),
      ).rejects.toThrow(/check constraint/)
    }
    await expect(
      asUser(A, () =>
        db.query('update public.drafts set body = $2 where id = $1', [
          id,
          'x'.repeat(3000),
        ]),
      ),
    ).resolves.toBeDefined()
  })

  it('a user can delete their own draft, which removes its commit links', async () => {
    const id = await draftFor(A, projectA)
    const deleted = await asUser(A, () =>
      db.query('delete from public.drafts where id = $1', [id]),
    )
    expect(deleted.affectedRows).toBe(1)
    const links = await db.query('select * from public.draft_commits')
    expect(links.rows).toEqual([])
  })

  it('anon cannot read or write anything', async () => {
    await draftFor(A, projectA)
    for (const table of ['drafts', 'draft_commits', 'ai_usage']) {
      await expect(
        asRole(db, 'anon', () => db.query(`select * from public.${table}`)),
      ).rejects.toThrow(/permission denied/)
    }
    await expect(
      asRole(db, 'anon', () => db.query('delete from public.drafts')),
    ).rejects.toThrow(/permission denied/)
  })

  it('a signed-in user can never read the usage ledger', async () => {
    await reserve(A)
    await expect(
      asUser(A, () => db.query('select * from public.ai_usage')),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asUser(A, () => db.query('delete from public.ai_usage')),
    ).rejects.toThrow(/permission denied/)
  })

  it('a soft-deleted account sees and changes nothing', async () => {
    const id = await draftFor(A, projectA)
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    const rows = await asUser(A, async () => {
      const result = await db.query('select * from public.drafts')
      return result.rows
    })
    expect(rows).toEqual([])
    const links = await asUser(A, async () => {
      const result = await db.query('select * from public.draft_commits')
      return result.rows
    })
    expect(links).toEqual([])
    const edit = await asUser(A, () =>
      db.query("update public.drafts set body = 'x' where id = $1", [id]),
    )
    expect(edit.affectedRows).toBe(0)
    const del = await asUser(A, () =>
      db.query('delete from public.drafts where id = $1', [id]),
    )
    expect(del.affectedRows).toBe(0)
    const copied = await asUser(A, () =>
      db.query('select public.mark_draft_copied($1) as ok', [id]),
    )
    expect((copied.rows[0] as { ok: boolean }).ok).toBe(false)
  })

  it('deleting a user, or a project, removes the drafts', async () => {
    await draftFor(A, projectA)
    await draftFor(B, projectB, [SHA2])
    await db.exec(`delete from public.projects where id = '${projectA}'`)
    expect((await db.query('select * from public.drafts')).rows).toHaveLength(1)
    await db.exec(`delete from auth.users where id = '${B}'`)
    expect((await db.query('select * from public.drafts')).rows).toEqual([])
    expect((await db.query('select * from public.draft_commits')).rows).toEqual(
      [],
    )
    const usageOfB = await db.query(
      'select * from public.ai_usage where user_id = $1',
      [B],
    )
    expect(usageOfB.rows).toEqual([])
  })

  it('commit shas must look like shas', async () => {
    const usage = await reserve(A)
    for (const sha of [
      'xyz1234',
      'abc',
      'A'.repeat(41),
      '../../x',
      "a'; drop",
    ]) {
      await expect(
        complete(usage, A, projectA, { shas: [sha] }),
      ).rejects.toThrow(/check constraint/)
    }
  })
})

describe('mark_draft_copied', () => {
  it('marks the caller’s own draft copied, once', async () => {
    const id = await draftFor(A, projectA)
    const first = await asUser(A, () =>
      db.query('select public.mark_draft_copied($1) as ok', [id]),
    )
    expect((first.rows[0] as { ok: boolean }).ok).toBe(true)
    const row = await db.query<{ status: string; copied_at: Date | null }>(
      'select status, copied_at from public.drafts where id = $1',
      [id],
    )
    expect(row.rows[0]?.status).toBe('copied')
    const stamp = row.rows[0]?.copied_at
    expect(stamp).toBeInstanceOf(Date)
    await asUser(A, () => db.query('select public.mark_draft_copied($1)', [id]))
    const again = await db.query<{ copied_at: Date }>(
      'select copied_at from public.drafts where id = $1',
      [id],
    )
    expect(again.rows[0]?.copied_at.getTime()).toBe(stamp?.getTime())
  })

  it('does nothing for another user’s draft', async () => {
    const id = await draftFor(B, projectB)
    const result = await asUser(A, () =>
      db.query('select public.mark_draft_copied($1) as ok', [id]),
    )
    expect((result.rows[0] as { ok: boolean }).ok).toBe(false)
    const row = await db.query<{ status: string }>(
      'select status from public.drafts where id = $1',
      [id],
    )
    expect(row.rows[0]?.status).toBe('draft')
  })

  it('is not callable by anon', async () => {
    const id = await draftFor(A, projectA)
    await expect(
      asRole(db, 'anon', () =>
        db.query('select public.mark_draft_copied($1)', [id]),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('the daily limit (10 per user per UTC day)', () => {
  it('allows 10 and refuses the 11th, with its own error code', async () => {
    for (let i = 0; i < 10; i += 1) await reserve(A)
    await expect(reserve(A)).rejects.toMatchObject({ code: 'SN010' })
  })

  it('counts completed generations, not just reservations', async () => {
    for (let i = 0; i < 10; i += 1) await draftFor(A, projectA)
    await expect(reserve(A)).rejects.toMatchObject({ code: 'SN010' })
  })

  it('is per user', async () => {
    for (let i = 0; i < 10; i += 1) await reserve(A)
    await expect(reserve(B)).resolves.toBeTruthy()
  })

  it('never lets simultaneous requests exceed 10', async () => {
    // PGlite runs one connection, so these are serialised; this checks the
    // count holds across a burst. The advisory locks are what protect a real
    // multi-connection server (see the README).
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => reserve(A)),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10)
    expect(
      results.filter(
        (r) =>
          r.status === 'rejected' &&
          (r.reason as { code?: string }).code === 'SN010',
      ),
    ).toHaveLength(15)
  })

  it('a released reservation frees its slot', async () => {
    const ids: string[] = []
    for (let i = 0; i < 10; i += 1) ids.push(await reserve(A))
    await expect(reserve(A)).rejects.toMatchObject({ code: 'SN010' })
    await service(() =>
      db.query('select public.release_generation($1, $2)', [ids[0], A]),
    )
    await expect(reserve(A)).resolves.toBeTruthy()
  })

  it('yesterday’s generations do not count today', async () => {
    for (let i = 0; i < 10; i += 1) {
      await db.query(
        `insert into public.ai_usage (user_id, day, month, status, cost_microusd)
         values ($1, (now() at time zone 'utc')::date - 1, date_trunc('month', now() at time zone 'utc')::date, 'completed', 1)`,
        [A],
      )
    }
    await expect(reserve(A)).resolves.toBeTruthy()
  })

  it('a stale reservation (older than 5 minutes) is ignored', async () => {
    for (let i = 0; i < 10; i += 1) await reserve(A)
    await expect(reserve(A)).rejects.toMatchObject({ code: 'SN010' })
    await db.exec(
      `update public.ai_usage set created_at = now() - interval '6 minutes' where user_id = '${A}'`,
    )
    await expect(reserve(A)).resolves.toBeTruthy()
  })

  it('an output that was not usable still counts', async () => {
    const ids: string[] = []
    for (let i = 0; i < 10; i += 1) ids.push(await reserve(A))
    for (const id of ids) {
      await service(() =>
        db.query('select public.record_unusable_generation($1, $2, 1500)', [
          id,
          A,
        ]),
      )
    }
    await expect(reserve(A)).rejects.toMatchObject({ code: 'SN010' })
  })

  it('reports how many were used today', async () => {
    await reserve(A)
    await draftFor(A, projectA)
    const released = await reserve(A)
    await service(() =>
      db.query('select public.release_generation($1, $2)', [released, A]),
    )
    const used = await service(() =>
      db.query<{ n: number }>('select public.generations_used_today($1) as n', [
        A,
      ]),
    )
    expect(used.rows[0]?.n).toBe(2)
  })

  it.each([
    ['a null user', [null, 1000, 10, 1_000_000]],
    ['a zero estimate', [A, 0, 10, 1_000_000]],
    ['a negative estimate', [A, -5, 10, 1_000_000]],
    ['a zero daily limit', [A, 1000, 0, 1_000_000]],
    ['a zero cap', [A, 1000, 10, 0]],
  ])('refuses %s (fails closed)', async (_label, args) => {
    await expect(
      service(() =>
        db.query('select public.reserve_generation($1, $2, $3, $4)', args),
      ),
    ).rejects.toMatchObject({ code: 'SN012' })
    expect((await db.query('select * from public.ai_usage')).rows).toEqual([])
  })
})

describe('the monthly cap', () => {
  const CAP = 10_000

  it('refuses when completed spend plus this estimate would pass the cap', async () => {
    const id = await reserve(A, 4000, 10, CAP)
    await complete(id, A, projectA, { cost: 4000 })
    await reserve(A, 5000, 10, CAP)
    await expect(reserve(A, 1500, 10, CAP)).rejects.toMatchObject({
      code: 'SN011',
    })
  })

  it('counts outstanding reservations as spend', async () => {
    await reserve(A, 6000, 10, CAP)
    await expect(reserve(B, 4500, 10, CAP)).rejects.toMatchObject({
      code: 'SN011',
    })
    await expect(reserve(B, 4000, 10, CAP)).resolves.toBeTruthy()
  })

  it('is shared by all users', async () => {
    await reserve(A, 9000, 10, CAP)
    await expect(reserve(B, 2000, 10, CAP)).rejects.toMatchObject({
      code: 'SN011',
    })
  })

  it('uses the real cost once a generation completes, not the estimate', async () => {
    const id = await reserve(A, 9000, 10, CAP)
    await complete(id, A, projectA, { cost: 1000 })
    await expect(reserve(B, 8000, 10, CAP)).resolves.toBeTruthy()
  })

  it('a release frees the reserved amount', async () => {
    const id = await reserve(A, 9000, 10, CAP)
    await expect(reserve(B, 2000, 10, CAP)).rejects.toMatchObject({
      code: 'SN011',
    })
    await service(() =>
      db.query('select public.release_generation($1, $2)', [id, A]),
    )
    await expect(reserve(B, 2000, 10, CAP)).resolves.toBeTruthy()
  })

  it('a stale reservation no longer holds its amount', async () => {
    await reserve(A, 9000, 10, CAP)
    await db.exec(
      "update public.ai_usage set created_at = now() - interval '6 minutes'",
    )
    await expect(reserve(B, 5000, 10, CAP)).resolves.toBeTruthy()
  })

  it('last month’s spend does not count', async () => {
    await db.query(
      `insert into public.ai_usage (user_id, day, month, status, cost_microusd)
       values ($1, (now() at time zone 'utc')::date - 40,
               (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date,
               'completed', 9999)`,
      [A],
    )
    await expect(reserve(B, 9000, 10, CAP)).resolves.toBeTruthy()
  })

  it('an unusable output still costs its tokens against the cap', async () => {
    const id = await reserve(A, 1000, 10, CAP)
    await service(() =>
      db.query('select public.record_unusable_generation($1, $2, 9500)', [
        id,
        A,
      ]),
    )
    await expect(reserve(B, 1000, 10, CAP)).rejects.toMatchObject({
      code: 'SN011',
    })
  })

  it('allows exactly up to the cap', async () => {
    await expect(reserve(A, CAP, 10, CAP)).resolves.toBeTruthy()
    await expect(reserve(B, 1, 10, CAP)).rejects.toMatchObject({
      code: 'SN011',
    })
  })
})

describe('complete_generation is atomic', () => {
  it('writes the draft, its links and the final cost together', async () => {
    const usage = await reserve(A)
    const draft = await complete(usage, A, projectA, {
      shas: [SHA1, SHA2.toUpperCase(), SHA1],
      cost: 1234,
    })
    const links = await db.query<{ commit_sha: string }>(
      'select commit_sha from public.draft_commits where draft_id = $1 order by commit_sha',
      [draft],
    )
    expect(links.rows.map((r) => r.commit_sha)).toEqual([SHA1, SHA2])
    const row = await db.query<{ status: string; cost_microusd: string }>(
      'select status, cost_microusd from public.ai_usage where id = $1',
      [usage],
    )
    expect(row.rows[0]).toMatchObject({ status: 'completed' })
    expect(Number(row.rows[0]?.cost_microusd)).toBe(1234)
  })

  it('a bad body leaves no draft, no links and an unchanged reservation', async () => {
    const usage = await reserve(A)
    await expect(
      complete(usage, A, projectA, { body: 'x'.repeat(3001) }),
    ).rejects.toThrow(/check constraint/)
    expect((await db.query('select * from public.drafts')).rows).toEqual([])
    expect((await db.query('select * from public.draft_commits')).rows).toEqual(
      [],
    )
    const row = await db.query<{ status: string }>(
      'select status from public.ai_usage where id = $1',
      [usage],
    )
    expect(row.rows[0]?.status).toBe('reserved')
  })

  it('a bad commit sha rolls back the draft as well', async () => {
    const usage = await reserve(A)
    await expect(
      complete(usage, A, projectA, { shas: ['not-a-sha'] }),
    ).rejects.toThrow()
    expect((await db.query('select * from public.drafts')).rows).toEqual([])
  })

  it('refuses a reservation that belongs to someone else, or is already used', async () => {
    const usage = await reserve(A)
    await expect(complete(usage, B, projectB)).rejects.toMatchObject({
      code: 'SN013',
    })
    await complete(usage, A, projectA)
    await expect(complete(usage, A, projectA)).rejects.toMatchObject({
      code: 'SN013',
    })
    expect((await db.query('select * from public.drafts')).rows).toHaveLength(1)
  })

  it('refuses a released or unknown reservation', async () => {
    const usage = await reserve(A)
    await service(() =>
      db.query('select public.release_generation($1, $2)', [usage, A]),
    )
    await expect(complete(usage, A, projectA)).rejects.toMatchObject({
      code: 'SN013',
    })
    await expect(
      complete('00000000-0000-0000-0000-0000000000ff', A, projectA),
    ).rejects.toMatchObject({ code: 'SN013' })
  })
})

describe('release_generation', () => {
  it('only releases the owner’s reservation, and only while reserved', async () => {
    const usage = await reserve(A)
    await service(() =>
      db.query('select public.release_generation($1, $2)', [usage, B]),
    )
    expect(
      (await db.query<{ status: string }>('select status from public.ai_usage'))
        .rows[0]?.status,
    ).toBe('reserved')

    await complete(usage, A, projectA)
    await service(() =>
      db.query('select public.release_generation($1, $2)', [usage, A]),
    )
    expect(
      (await db.query<{ status: string }>('select status from public.ai_usage'))
        .rows[0]?.status,
    ).toBe('completed')
  })
})

describe('only the service role can call the generation functions', () => {
  const calls: [string, unknown[]][] = [
    ['reserve_generation', [A, 1000, 10, 1_000_000]],
    ['release_generation', ['00000000-0000-0000-0000-0000000000ff', A]],
    [
      'record_unusable_generation',
      ['00000000-0000-0000-0000-0000000000ff', A, 1],
    ],
    ['generations_used_today', [A]],
  ]

  it.each(calls)(
    '%s is refused for anon and authenticated',
    async (name, args) => {
      const placeholders = args.map((_, i) => `$${String(i + 1)}`).join(', ')
      for (const role of ['anon', 'authenticated']) {
        await expect(
          asRole(db, role, () =>
            db.query(`select public.${name}(${placeholders})`, args),
          ),
        ).rejects.toThrow(/permission denied/)
      }
    },
  )

  it('complete_generation is refused for anon and authenticated', async () => {
    const usage = await reserve(A)
    for (const role of ['anon', 'authenticated']) {
      await expect(
        asRole(db, role, () =>
          db.query(
            `select public.complete_generation($1, $2, $3, 'x', 'm', 1, 1, 1, '{}')`,
            [usage, A, projectA],
          ),
        ),
      ).rejects.toThrow(/permission denied/)
    }
  })
})
