import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'

beforeAll(async () => {
  db = await createDb()
}, 60_000)

beforeEach(async () => {
  await db.exec('delete from auth.users;')
  await db.exec(`
    insert into auth.users (id, email) values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `)
})

// Runs `fn` as a signed-in user: the authenticated role, with the verified
// subject claim that auth.uid() reads.
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

type Fields = {
  name?: string
  summary?: string | null
  stage?: string
  notes?: string
}

function insert(user: string, fields: Fields = {}, owner: string = user) {
  return asUser(user, () =>
    db.query<{ id: string }>(
      `insert into public.projects (user_id, name, summary, stage, notes)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        owner,
        fields.name ?? 'Project',
        fields.summary ?? null,
        fields.stage ?? 'idea',
        fields.notes ?? '',
      ],
    ),
  )
}

async function mine(user: string) {
  return asUser(user, async () => {
    const result = await db.query<{ id: string; name: string }>(
      'select id, name from public.projects order by name',
    )
    return result.rows
  })
}

async function seed(user: string, name: string) {
  const result = await db.query<{ id: string }>(
    `insert into public.projects (user_id, name, stage)
     values ($1, $2, 'idea') returning id`,
    [user, name],
  )
  return result.rows[0]?.id ?? ''
}

describe('one user cannot reach another user’s projects', () => {
  it('sees only their own rows', async () => {
    await seed(A, 'A one')
    await seed(B, 'B one')
    expect((await mine(A)).map((row) => row.name)).toEqual(['A one'])
    expect((await mine(B)).map((row) => row.name)).toEqual(['B one'])
  })

  it('cannot select another user’s project by id', async () => {
    const id = await seed(B, 'B one')
    const rows = await asUser(A, async () => {
      const result = await db.query(
        'select * from public.projects where id = $1',
        [id],
      )
      return result.rows
    })
    expect(rows).toEqual([])
  })

  it('cannot update another user’s project', async () => {
    const id = await seed(B, 'B one')
    const result = await asUser(A, () =>
      db.query("update public.projects set name = 'hijacked' where id = $1", [
        id,
      ]),
    )
    expect(result.affectedRows).toBe(0)
    const row = await db.query<{ name: string }>(
      'select name from public.projects where id = $1',
      [id],
    )
    expect(row.rows[0]?.name).toBe('B one')
  })

  it('cannot delete another user’s project', async () => {
    const id = await seed(B, 'B one')
    const result = await asUser(A, () =>
      db.query('delete from public.projects where id = $1', [id]),
    )
    expect(result.affectedRows).toBe(0)
    expect(await mine(B)).toHaveLength(1)
  })

  it('cannot insert a project owned by someone else', async () => {
    await expect(insert(A, {}, B)).rejects.toThrow(/row-level security/)
    expect(await mine(B)).toEqual([])
  })

  it('cannot hand a project to someone else with an update', async () => {
    const id = await seed(A, 'A one')
    await expect(
      asUser(A, () =>
        db.query('update public.projects set user_id = $2 where id = $1', [
          id,
          B,
        ]),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot change id or the timestamps', async () => {
    const id = await seed(A, 'A one')
    for (const column of ['id', 'created_at', 'updated_at']) {
      await expect(
        asUser(A, () =>
          db.query(
            `update public.projects set ${column} = ${column} where id = $1`,
            [id],
          ),
        ),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('a user can read, update and delete their own project', async () => {
    const id = (await insert(A, { name: 'Mine' })).rows[0]?.id ?? ''
    const updated = await asUser(A, () =>
      db.query("update public.projects set name = 'Renamed' where id = $1", [
        id,
      ]),
    )
    expect(updated.affectedRows).toBe(1)
    expect((await mine(A)).map((row) => row.name)).toEqual(['Renamed'])
    const deleted = await asUser(A, () =>
      db.query('delete from public.projects where id = $1', [id]),
    )
    expect(deleted.affectedRows).toBe(1)
  })
})

describe('anon', () => {
  it('cannot read', async () => {
    await seed(A, 'A one')
    await expect(
      asRole(db, 'anon', () => db.query('select * from public.projects')),
    ).rejects.toThrow(/permission denied/)
  })

  it.each([
    [
      'insert',
      `insert into public.projects (user_id, name, stage) values ('${A}', 'x', 'idea')`,
    ],
    ['update', "update public.projects set name = 'x'"],
    ['delete', 'delete from public.projects'],
  ])('cannot %s', async (_label, statement) => {
    await seed(A, 'A one')
    await expect(asRole(db, 'anon', () => db.query(statement))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('a signed-in user with no subject claim sees nothing', async () => {
    await seed(A, 'A one')
    const rows = await asRole(db, 'authenticated', async () => {
      const result = await db.query('select * from public.projects')
      return result.rows
    })
    expect(rows).toEqual([])
  })
})

describe('the limit of 5 projects', () => {
  it('allows 5 and refuses the 6th with a distinct error', async () => {
    for (let i = 1; i <= 5; i += 1) await insert(A, { name: `P${i}` })
    await expect(insert(A, { name: 'P6' })).rejects.toMatchObject({
      code: 'SN001',
      message: expect.stringContaining('project_limit_reached') as string,
    })
    expect(await mine(A)).toHaveLength(5)
  })

  it('is per user', async () => {
    for (let i = 1; i <= 5; i += 1) await insert(A, { name: `P${i}` })
    await expect(insert(B, { name: 'B1' })).resolves.toBeDefined()
  })

  it('frees a slot when a project is deleted', async () => {
    for (let i = 1; i <= 5; i += 1) await insert(A, { name: `P${i}` })
    await asUser(A, () =>
      db.query("delete from public.projects where name = 'P1'"),
    )
    await expect(insert(A, { name: 'P6' })).resolves.toBeDefined()
  })

  it('also binds the service role, since it is a trigger', async () => {
    for (let i = 1; i <= 5; i += 1) await seed(A, `P${i}`)
    await expect(
      asRole(db, 'service_role', () =>
        db.query(
          `insert into public.projects (user_id, name, stage) values ('${A}', 'P6', 'idea')`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'SN001' })
  })
})

describe('constraints', () => {
  const longText = (n: number) => 'x'.repeat(n)

  it.each([
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a name of 81 characters', { name: longText(81) }],
    ['a summary of 301 characters', { summary: longText(301) }],
    ['notes of 12,001 characters', { notes: longText(12_001) }],
    ['an unknown stage', { stage: 'launched' }],
    ['an empty stage', { stage: '' }],
  ])('rejects %s', async (_label, fields) => {
    await expect(insert(A, fields)).rejects.toThrow(/check constraint/)
  })

  it.each([
    ['a name of 80 characters', { name: longText(80) }],
    ['a summary of 300 characters', { summary: longText(300) }],
    ['no summary', { summary: null }],
    ['notes of 12,000 characters', { notes: longText(12_000) }],
    ['empty notes', { notes: '' }],
    ['stage idea', { stage: 'idea' }],
    ['stage in_progress', { stage: 'in_progress' }],
    ['stage shipped', { stage: 'shipped' }],
  ])('accepts %s', async (_label, fields) => {
    await expect(insert(A, fields)).resolves.toBeDefined()
  })

  it('counts characters, not bytes', async () => {
    // Each of these is several bytes in UTF-8 but one character.
    await expect(
      insert(A, { notes: '\u{1F680}'.repeat(12_000) }),
    ).resolves.toBeDefined()
    await expect(insert(B, { name: 'é'.repeat(80) })).resolves.toBeDefined()
  })

  it('applies the same checks to an update', async () => {
    const id = (await insert(A)).rows[0]?.id ?? ''
    await expect(
      asUser(A, () =>
        db.query('update public.projects set stage = $2 where id = $1', [
          id,
          'nope',
        ]),
      ),
    ).rejects.toThrow(/check constraint/)
    await expect(
      asUser(A, () =>
        db.query('update public.projects set notes = $2 where id = $1', [
          id,
          longText(12_001),
        ]),
      ),
    ).rejects.toThrow(/check constraint/)
  })
})

describe('updated_at', () => {
  it('moves forward on an update and not on a plain read', async () => {
    const id = await seed(A, 'A one')
    const before = await db.query<{ updated_at: Date }>(
      'select updated_at from public.projects where id = $1',
      [id],
    )
    await db.query('select pg_sleep(0.05)')
    await asUser(A, () =>
      db.query("update public.projects set name = 'Changed' where id = $1", [
        id,
      ]),
    )
    const after = await db.query<{ updated_at: Date }>(
      'select updated_at from public.projects where id = $1',
      [id],
    )
    expect(after.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]?.updated_at.getTime() ?? Infinity,
    )
  })
})

describe('a soft-deleted account', () => {
  beforeEach(async () => {
    await seed(A, 'A one')
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
  })

  it('cannot read its projects, even with a valid token', async () => {
    expect(await mine(A)).toEqual([])
  })

  it('cannot create a project', async () => {
    await expect(insert(A)).rejects.toThrow(/row-level security/)
  })

  it('cannot update or delete', async () => {
    const updated = await asUser(A, () =>
      db.query("update public.projects set name = 'x'"),
    )
    expect(updated.affectedRows).toBe(0)
    const deleted = await asUser(A, () =>
      db.query('delete from public.projects'),
    )
    expect(deleted.affectedRows).toBe(0)
    const rows = await db.query('select * from public.projects')
    expect(rows.rows).toHaveLength(1)
  })

  it('does not affect anyone else', async () => {
    await insert(B, { name: 'B one' })
    expect((await mine(B)).map((row) => row.name)).toEqual(['B one'])
  })

  it('is_active_account is false for it and for nobody', async () => {
    const ask = (user: string) =>
      asUser(user, async () => {
        const result = await db.query<{ ok: boolean }>(
          'select public.is_active_account() as ok',
        )
        return result.rows[0]?.ok
      })
    expect(await ask(A)).toBe(false)
    expect(await ask(B)).toBe(true)
    const anon = await asRole(db, 'anon', () =>
      db.query('select public.is_active_account()'),
    ).catch((error: unknown) => error)
    expect(anon).toBeInstanceOf(Error)
  })
})

describe('deleting a user', () => {
  it('removes their projects and no one else’s', async () => {
    await seed(A, 'A one')
    await seed(A, 'A two')
    await seed(B, 'B one')
    await db.exec(`delete from auth.users where id = '${A}'`)
    const rows = await db.query<{ user_id: string }>(
      'select user_id from public.projects',
    )
    expect(rows.rows).toEqual([{ user_id: B }])
  })
})
