import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

type Hook = { error?: { message: string; http_code: number } }

function event(user: Record<string, unknown>) {
  return JSON.stringify({
    metadata: { name: 'before-user-created' },
    user,
  })
}

const emailUser = (email: string) =>
  event({ email, app_metadata: { provider: 'email' }, user_metadata: {} })

const githubUser = (email: string, meta: Record<string, unknown>) =>
  event({
    email,
    app_metadata: { provider: 'github' },
    user_metadata: meta,
    identities: [],
  })

// Calls the hook the way Supabase Auth does: as supabase_auth_admin.
async function hook(payload: string): Promise<Hook> {
  return asRole(db, 'supabase_auth_admin', async () => {
    const result = await db.query<{ r: Hook }>(
      'select public.hook_before_user_created($1::jsonb) as r',
      [payload],
    )
    return result.rows[0]?.r ?? {}
  })
}

async function invite(email: string) {
  await db.query('insert into public.invites (email) values ($1)', [email])
}

// One database for the file (starting it is slow), emptied between tests.
beforeAll(async () => {
  db = await createDb()
}, 60_000)

beforeEach(async () => {
  await db.exec('delete from auth.users; delete from public.invites;')
})

describe('before user created hook: email link', () => {
  it('lets an invited email through', async () => {
    await invite('ada@example.com')
    expect(await hook(emailUser('ada@example.com'))).toEqual({})
  })

  it('rejects an uninvited email with a generic message', async () => {
    await invite('ada@example.com')
    const result = await hook(emailUser('eve@example.com'))
    expect(result.error?.http_code).toBe(403)
    expect(result.error?.message).toBe('Sign-up is invite only.')
  })

  it('ignores case differences in the email', async () => {
    await invite('Ada@Example.COM')
    expect(await hook(emailUser('aDA@example.com'))).toEqual({})
  })

  it('ignores surrounding spaces', async () => {
    await invite('ada@example.com')
    expect(await hook(emailUser('  ada@example.com '))).toEqual({})
  })

  it('rejects a missing email', async () => {
    const result = await hook(
      event({ app_metadata: { provider: 'email' }, user_metadata: {} }),
    )
    expect(result.error?.message).toBe('Sign-up is invite only.')
  })

  it('marks the invite used, and an invite works once', async () => {
    await invite('ada@example.com')
    await hook(emailUser('ada@example.com'))
    const used = await db.query<{ used_at: Date | null }>(
      'select used_at from public.invites',
    )
    expect(used.rows[0]?.used_at).not.toBeNull()
    const again = await hook(emailUser('ada@example.com'))
    expect(again.error?.http_code).toBe(403)
  })

  it('records who used the invite once the user row exists', async () => {
    await invite('ada@example.com')
    await hook(emailUser('ada@example.com'))
    const created = await db.query<{ id: string }>(
      "insert into auth.users (email) values ('ADA@example.com') returning id",
    )
    const row = await db.query<{ used_by: string | null }>(
      'select used_by from public.invites',
    )
    expect(row.rows[0]?.used_by).toBe(created.rows[0]?.id)
  })

  it('keeps the used invite when the user is deleted', async () => {
    await invite('ada@example.com')
    await hook(emailUser('ada@example.com'))
    await db.exec("insert into auth.users (email) values ('ada@example.com')")
    await db.exec('delete from auth.users')
    const row = await db.query<{
      used_at: Date | null
      used_by: string | null
    }>('select used_at, used_by from public.invites')
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]?.used_at).not.toBeNull()
    expect(row.rows[0]?.used_by).toBeNull()
    // And the same invite cannot be used to sign up again.
    expect((await hook(emailUser('ada@example.com'))).error).toBeDefined()
  })
})

describe('before user created hook: GitHub', () => {
  beforeEach(async () => {
    await invite('ada@example.com')
  })

  it('allows an invited email GitHub reports as verified', async () => {
    expect(
      await hook(githubUser('ada@example.com', { email_verified: true })),
    ).toEqual({})
  })

  it.each([
    ['missing', {}],
    ['false', { email_verified: false }],
    ['null', { email_verified: null }],
    ['the string "true"', { email_verified: 'true' }],
    ['the number 1', { email_verified: 1 }],
  ])('rejects when email_verified is %s', async (_label, meta) => {
    const result = await hook(githubUser('ada@example.com', meta))
    expect(result.error?.message).toBe('Sign-up is invite only.')
    // A refusal must not use up the invite.
    const row = await db.query<{ used_at: Date | null }>(
      'select used_at from public.invites',
    )
    expect(row.rows[0]?.used_at).toBeNull()
  })

  it('rejects when an identity says the email is not verified', async () => {
    const payload = event({
      email: 'ada@example.com',
      app_metadata: { provider: 'github' },
      user_metadata: { email_verified: true },
      identities: [{ identity_data: { email_verified: false } }],
    })
    expect((await hook(payload)).error?.http_code).toBe(403)
  })

  it('still needs an invite, even when verified', async () => {
    const result = await hook(
      githubUser('eve@example.com', { email_verified: true }),
    )
    expect(result.error?.http_code).toBe(403)
  })

  it('rejects a provider it does not know', async () => {
    const payload = event({
      email: 'ada@example.com',
      app_metadata: { provider: 'gitlab' },
      user_metadata: { email_verified: true },
    })
    expect((await hook(payload)).error?.http_code).toBe(403)
  })
})

describe('privileges', () => {
  beforeEach(async () => {
    await invite('ada@example.com')
  })

  it.each(['anon', 'authenticated'])('%s cannot read invites', async (role) => {
    await expect(
      asRole(db, role, () => db.query('select * from public.invites')),
    ).rejects.toThrow(/permission denied/i)
  })

  it.each(['anon', 'authenticated'])(
    '%s cannot write invites',
    async (role) => {
      await expect(
        asRole(db, role, () =>
          db.query("insert into public.invites (email) values ('x@y.co')"),
        ),
      ).rejects.toThrow(/permission denied/i)
      await expect(
        asRole(db, role, () =>
          db.query('update public.invites set used_at = now()'),
        ),
      ).rejects.toThrow(/permission denied/i)
    },
  )

  it.each(['anon', 'authenticated'])(
    '%s cannot call the hook',
    async (role) => {
      await expect(
        asRole(db, role, () =>
          db.query("select public.hook_before_user_created('{}'::jsonb)"),
        ),
      ).rejects.toThrow(/permission denied/i)
    },
  )

  it('row-level security is on', async () => {
    const result = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.invites'::regclass",
    )
    expect(result.rows[0]?.relrowsecurity).toBe(true)
  })

  it('supabase_auth_admin can run the hook but cannot read the table', async () => {
    expect(await hook(emailUser('ada@example.com'))).toEqual({})
    await expect(
      asRole(db, 'supabase_auth_admin', () =>
        db.query('select * from public.invites'),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('the hook is security definer with a fixed search path', async () => {
    const result = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where proname = 'hook_before_user_created'",
    )
    expect(result.rows[0]?.prosecdef).toBe(true)
    expect(result.rows[0]?.proconfig).toContain('search_path=""')
  })
})
