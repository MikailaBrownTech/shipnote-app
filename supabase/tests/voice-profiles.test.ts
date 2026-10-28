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

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toThrow(/permission denied|must be owner|row-level/i)

const violates = (promise: Promise<unknown>) =>
  expect(promise).rejects.toThrow(/violates check constraint/i)

// Inserts through the signed-in user's own role, so policies and grants apply.
function saveAs(
  user: string,
  fields: {
    tone?: string
    notes?: string
    samples?: string[]
    avoid?: string[]
    signoff?: string
  } = {},
  owner = user,
) {
  return asUser(user, () =>
    db.query(
      `insert into public.voice_profiles
         (user_id, tone, voice_notes, sample_posts, avoid_words, signoff)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        owner,
        fields.tone ?? 'professional',
        fields.notes ?? '',
        fields.samples ?? [],
        fields.avoid ?? [],
        fields.signoff ?? '',
      ],
    ),
  )
}

const mine = (user: string) =>
  asUser(user, () =>
    db.query<{ user_id: string; tone: string; voice_notes: string }>(
      'select user_id, tone, voice_notes from public.voice_profiles',
    ),
  ).then((r) => r.rows)

const text = (n: number) => 'x'.repeat(n)

describe('own row', () => {
  it('a user saves, reads, updates and deletes their own profile', async () => {
    await saveAs(A, { tone: 'casual', notes: 'Short and dry.' })
    expect(await mine(A)).toEqual([
      { user_id: A, tone: 'casual', voice_notes: 'Short and dry.' },
    ])
    await asUser(A, () =>
      db.query("update public.voice_profiles set tone = 'direct'"),
    )
    expect((await mine(A))[0]?.tone).toBe('direct')
    await asUser(A, () => db.query('delete from public.voice_profiles'))
    expect(await mine(A)).toEqual([])
  })

  it('a row with only a user id gets the default tone and nothing else', async () => {
    await asUser(A, () =>
      db.query('insert into public.voice_profiles (user_id) values ($1)', [A]),
    )
    const result = await service(() =>
      db.query<{
        tone: string
        voice_notes: string
        sample_posts: string[]
        avoid_words: string[]
        signoff: string
      }>('select * from public.voice_profiles'),
    )
    expect(result.rows[0]).toMatchObject({
      tone: 'professional',
      voice_notes: '',
      sample_posts: [],
      avoid_words: [],
      signoff: '',
    })
  })

  it('there is only one profile per user', async () => {
    await saveAs(A)
    await expect(saveAs(A)).rejects.toThrow(/duplicate key|unique/i)
  })

  it('updating moves updated_at forward', async () => {
    await saveAs(A)
    await db.exec(
      "update public.voice_profiles set updated_at = '2020-01-01T00:00:00Z'",
    )
    await asUser(A, () =>
      db.query("update public.voice_profiles set voice_notes = 'new'"),
    )
    const result = await service(() =>
      db.query<{ later: boolean }>(
        "select updated_at > '2021-01-01' as later from public.voice_profiles",
      ),
    )
    expect(result.rows[0]?.later).toBe(true)
  })

  it('the user id cannot be changed', async () => {
    await saveAs(A)
    await denied(
      asUser(A, () =>
        db.query('update public.voice_profiles set user_id = $1', [B]),
      ),
    )
  })
})

describe('isolation between users', () => {
  beforeEach(async () => {
    await saveAs(A, { tone: 'casual', notes: 'A only' })
    await saveAs(B, { tone: 'humble', notes: 'B only' })
  })

  it('each user sees only their own row', async () => {
    expect(await mine(A)).toEqual([
      { user_id: A, tone: 'casual', voice_notes: 'A only' },
    ])
    expect(await mine(B)).toEqual([
      { user_id: B, tone: 'humble', voice_notes: 'B only' },
    ])
  })

  it('a user cannot insert a row for someone else', async () => {
    await db.exec(`delete from public.voice_profiles where user_id = '${B}'`)
    await denied(saveAs(A, {}, B))
    const rows = await service(() =>
      db.query('select 1 from public.voice_profiles where user_id = $1', [B]),
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('an update or delete aimed at another user changes nothing', async () => {
    const updated = await asUser(A, () =>
      db.query(
        "update public.voice_profiles set voice_notes = 'hacked' where user_id = $1 returning 1",
        [B],
      ),
    )
    expect(updated.rows).toHaveLength(0)
    const deleted = await asUser(A, () =>
      db.query(
        'delete from public.voice_profiles where user_id = $1 returning 1',
        [B],
      ),
    )
    expect(deleted.rows).toHaveLength(0)
    expect((await mine(B))[0]?.voice_notes).toBe('B only')
  })

  it('a user cannot read another profile by asking for it', async () => {
    const result = await asUser(A, () =>
      db.query('select * from public.voice_profiles where user_id = $1', [B]),
    )
    expect(result.rows).toHaveLength(0)
  })

  it('an upsert cannot take over another user’s row', async () => {
    await denied(
      asUser(A, () =>
        db.query(
          `insert into public.voice_profiles (user_id, tone) values ($1, 'direct')
           on conflict (user_id) do update set tone = excluded.tone`,
          [B],
        ),
      ),
    )
    expect((await mine(B))[0]?.tone).toBe('humble')
  })
})

describe('limits enforced by the database', () => {
  it('accepts the largest allowed values', async () => {
    await saveAs(A, {
      notes: text(500),
      samples: [text(1500), text(1500), text(1500)],
      avoid: Array.from({ length: 15 }, () => text(30)),
      signoff: text(80),
    })
    expect(await mine(A)).toHaveLength(1)
  })

  it.each([
    ['a 4th sample post', { samples: ['a', 'b', 'c', 'd'] }],
    ['a 501 character note', { notes: text(501) }],
    ['a 1,501 character sample', { samples: [text(1501)] }],
    ['an empty sample', { samples: [''] }],
    ['a 16th avoid word', { avoid: Array.from({ length: 16 }, () => 'a') }],
    ['a 31 character avoid word', { avoid: [text(31)] }],
    ['an empty avoid word', { avoid: [''] }],
    ['an 81 character sign-off', { signoff: text(81) }],
    ['a line break in the sign-off', { signoff: 'Thanks\nBye' }],
    ['a control character in the sign-off', { signoff: 'Bye\u0007' }],
    ['an unknown tone', { tone: 'sarcastic' }],
    ['an empty tone', { tone: '' }],
    ['a tone in the wrong case', { tone: 'Casual' }],
  ])('refuses %s', async (_name, fields) => {
    await violates(saveAs(A, fields))
    expect(await mine(A)).toEqual([])
  })

  it('refuses a null in a list, and a nested list', async () => {
    await violates(
      asUser(A, () =>
        db.query(
          `insert into public.voice_profiles (user_id, sample_posts)
           values ($1, array['a', null])`,
          [A],
        ),
      ),
    )
    await violates(
      asUser(A, () =>
        db.query(
          `insert into public.voice_profiles (user_id, avoid_words)
           values ($1, array[array['a','b'], array['c','d']])`,
          [A],
        ),
      ),
    )
  })

  it('refuses the same limits on update', async () => {
    await saveAs(A)
    await violates(
      asUser(A, () =>
        db.query(
          "update public.voice_profiles set sample_posts = array['a','b','c','d']",
        ),
      ),
    )
    await violates(
      asUser(A, () =>
        db.query("update public.voice_profiles set tone = 'unknown'"),
      ),
    )
    await violates(
      asUser(A, () =>
        db.query('update public.voice_profiles set voice_notes = $1', [
          text(501),
        ]),
      ),
    )
  })

  it('counts characters, not bytes', async () => {
    await saveAs(A, { notes: 'é'.repeat(500), signoff: 'é'.repeat(80) })
    expect(await mine(A)).toHaveLength(1)
  })
})

describe('anon and soft-deleted accounts', () => {
  beforeEach(async () => {
    await saveAs(A, { notes: 'mine' })
  })

  it('anon can read, write and delete nothing', async () => {
    for (const sql of [
      'select * from public.voice_profiles',
      "insert into public.voice_profiles (user_id) values ('" + B + "')",
      "update public.voice_profiles set tone = 'direct'",
      'delete from public.voice_profiles',
    ]) {
      await denied(asRole(db, 'anon', () => db.query(sql)))
    }
  })

  it('a soft-deleted account sees and changes nothing', async () => {
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    expect(await mine(A)).toEqual([])
    const updated = await asUser(A, () =>
      db.query(
        "update public.voice_profiles set voice_notes = 'x' returning 1",
      ),
    )
    expect(updated.rows).toHaveLength(0)
    const deleted = await asUser(A, () =>
      db.query('delete from public.voice_profiles returning 1'),
    )
    expect(deleted.rows).toHaveLength(0)
    await db.exec(`delete from public.voice_profiles where user_id = '${A}'`)
    await denied(saveAs(A, { notes: 'again' }))
  })

  it('the signed-in role cannot call the worker read function', async () => {
    await denied(
      asUser(A, () =>
        db.query('select * from public.read_voice_profile($1)', [A]),
      ),
    )
    await denied(
      asRole(db, 'anon', () =>
        db.query('select * from public.read_voice_profile($1)', [A]),
      ),
    )
  })
})

describe('read_voice_profile (the worker)', () => {
  const read = (user: string | null) =>
    service(() =>
      db.query<{
        tone: string
        voice_notes: string
        sample_posts: string[]
        avoid_words: string[]
        signoff: string
      }>('select * from public.read_voice_profile($1)', [user]),
    ).then((r) => r.rows)

  beforeEach(async () => {
    await saveAs(A, {
      tone: 'casual',
      notes: 'A notes',
      samples: ['A sample'],
      avoid: ['synergy'],
      signoff: 'Cheers',
    })
    await saveAs(B, { tone: 'humble', notes: 'B notes' })
  })

  it('returns the profile of the user it is asked for, and no other', async () => {
    expect(await read(A)).toEqual([
      {
        tone: 'casual',
        voice_notes: 'A notes',
        sample_posts: ['A sample'],
        avoid_words: ['synergy'],
        signoff: 'Cheers',
      },
    ])
    expect((await read(B))[0]?.voice_notes).toBe('B notes')
  })

  it('returns nothing for a user with no profile, a null id or a soft-deleted account', async () => {
    await db.exec(`delete from public.voice_profiles where user_id = '${B}'`)
    expect(await read(B)).toEqual([])
    expect(await read(null)).toEqual([])
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    expect(await read(A)).toEqual([])
  })
})

describe('account deletion', () => {
  it('deleting the user deletes their profile and only theirs', async () => {
    await saveAs(A, { notes: 'a' })
    await saveAs(B, { notes: 'b' })
    await db.exec(`delete from auth.users where id = '${A}'`)
    const rows = await service(() =>
      db.query<{ user_id: string }>(
        'select user_id from public.voice_profiles',
      ),
    )
    expect(rows.rows.map((r) => r.user_id)).toEqual([B])
  })
})
