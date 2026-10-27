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

// What the server does after verifying with GitHub: write through the service
// role.
function install(user: string, installationId: number, login = 'octo') {
  return asRole(db, 'service_role', () =>
    db.query(
      `insert into public.github_installations
         (user_id, installation_id, account_login, account_id)
       values ($1, $2, $3, $4)`,
      [user, installationId, login, installationId * 10],
    ),
  )
}

async function project(user: string, name = 'P') {
  const result = await db.query<{ id: string }>(
    `insert into public.projects (user_id, name, stage)
     values ($1, $2, 'idea') returning id`,
    [user, name],
  )
  return result.rows[0]?.id ?? ''
}

function link(projectId: string, installationId: number | null, repo: string) {
  return asRole(db, 'service_role', () =>
    db.query(
      `update public.projects
          set installation_id = $2, repo_full_name = $3
        where id = $1`,
      [projectId, installationId, repo],
    ),
  )
}

async function rowOf(projectId: string) {
  const result = await db.query<{
    installation_id: number | null
    repo_full_name: string | null
  }>(
    'select installation_id, repo_full_name from public.projects where id = $1',
    [projectId],
  )
  return result.rows[0]
}

describe('github_installations: who can see and change rows', () => {
  it('a user reads only their own installations', async () => {
    await install(A, 1, 'alice')
    await install(B, 2, 'bob')
    const rows = await asUser(A, async () => {
      const result = await db.query<{ account_login: string }>(
        'select account_login from public.github_installations',
      )
      return result.rows
    })
    expect(rows).toEqual([{ account_login: 'alice' }])
  })

  it("a user cannot read another user's installation by id", async () => {
    await install(B, 2, 'bob')
    const rows = await asUser(A, async () => {
      const result = await db.query(
        'select * from public.github_installations where installation_id = 2',
      )
      return result.rows
    })
    expect(rows).toEqual([])
  })

  it('a user cannot insert an installation, for themselves or anyone', async () => {
    for (const owner of [A, B]) {
      await expect(
        asUser(A, () =>
          db.query(
            `insert into public.github_installations
               (user_id, installation_id, account_login, account_id)
             values ($1, 9, 'x', 9)`,
            [owner],
          ),
        ),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('a user cannot update or delete an installation, even their own', async () => {
    await install(A, 1)
    await expect(
      asUser(A, () =>
        db.query("update public.github_installations set account_login = 'x'"),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asUser(A, () => db.query('delete from public.github_installations')),
    ).rejects.toThrow(/permission denied/)
  })

  it('anon cannot read or write', async () => {
    await install(A, 1)
    await expect(
      asRole(db, 'anon', () =>
        db.query('select * from public.github_installations'),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asRole(db, 'anon', () =>
        db.query('delete from public.github_installations'),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('a soft-deleted account sees nothing', async () => {
    await install(A, 1)
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    const rows = await asUser(A, async () => {
      const result = await db.query('select * from public.github_installations')
      return result.rows
    })
    expect(rows).toEqual([])
  })

  it('an installation id belongs to one user only', async () => {
    await install(A, 1)
    await expect(install(B, 1)).rejects.toThrow(/duplicate key|unique/)
  })

  it('deleting the user removes their installations', async () => {
    await install(A, 1)
    await install(B, 2)
    await db.exec(`delete from auth.users where id = '${A}'`)
    const rows = await db.query<{ installation_id: string }>(
      'select installation_id from public.github_installations',
    )
    expect(rows.rows.map((r) => Number(r.installation_id))).toEqual([2])
  })
})

describe('projects: the repository link', () => {
  it("a project cannot point at another user's installation", async () => {
    await install(B, 2, 'bob')
    const id = await project(A)
    await expect(link(id, 2, 'bob/repo')).rejects.toThrow(/foreign key/)
    expect(await rowOf(id)).toMatchObject({ installation_id: null })
  })

  it('a project can point at its own owner’s installation', async () => {
    await install(A, 1, 'alice')
    const id = await project(A)
    await link(id, 1, 'alice/site')
    expect(await rowOf(id)).toMatchObject({
      installation_id: 1,
      repo_full_name: 'alice/site',
    })
  })

  it('an installation id that does not exist is refused', async () => {
    const id = await project(A)
    await expect(link(id, 404, 'alice/site')).rejects.toThrow(/foreign key/)
  })

  it('a user cannot set the link themselves, so the server check cannot be skipped', async () => {
    await install(A, 1)
    const id = await project(A)
    for (const column of ['installation_id', 'repo_full_name']) {
      await expect(
        asUser(A, () =>
          db.query(
            `update public.projects set ${column} = ${column} where id = $1`,
            [id],
          ),
        ),
      ).rejects.toThrow(/permission denied/)
    }
    await expect(
      asUser(A, () =>
        db.query(
          `insert into public.projects (user_id, name, stage, repo_full_name)
           values ($1, 'x', 'idea', 'alice/site')`,
          [A],
        ),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('a user can still edit the other project fields', async () => {
    await install(A, 1)
    const id = await project(A)
    await link(id, 1, 'alice/site')
    const result = await asUser(A, () =>
      db.query("update public.projects set name = 'Renamed' where id = $1", [
        id,
      ]),
    )
    expect(result.affectedRows).toBe(1)
  })

  it('a user reads the link on their own project only', async () => {
    await install(A, 1)
    await install(B, 2)
    const a = await project(A, 'mine')
    const b = await project(B, 'theirs')
    await link(a, 1, 'alice/site')
    await link(b, 2, 'bob/site')
    const rows = await asUser(A, async () => {
      const result = await db.query<{ repo_full_name: string }>(
        'select repo_full_name from public.projects',
      )
      return result.rows
    })
    expect(rows).toEqual([{ repo_full_name: 'alice/site' }])
  })

  it('removing the installation keeps the repo name and clears the id (needs reconnect)', async () => {
    await install(A, 1)
    const id = await project(A)
    await link(id, 1, 'alice/site')
    await asRole(db, 'service_role', () =>
      db.query(
        'delete from public.github_installations where installation_id = 1',
      ),
    )
    expect(await rowOf(id)).toEqual({
      installation_id: null,
      repo_full_name: 'alice/site',
    })
  })

  it('a project cannot have an installation without a repository', async () => {
    await install(A, 1)
    const id = await project(A)
    await expect(
      asRole(db, 'service_role', () =>
        db.query(
          'update public.projects set installation_id = 1 where id = $1',
          [id],
        ),
      ),
    ).rejects.toThrow(/check constraint/)
  })

  it.each([
    'noslash',
    'a/b/c',
    '/repo',
    'owner/',
    '-owner/repo',
    'owner/re po',
    'owner/..',
    'owner/.',
    "owner/repo'; drop table x;--",
    `${'o'.repeat(40)}/repo`,
    `owner/${'r'.repeat(101)}`,
  ])('rejects the repository name %s', async (name) => {
    await install(A, 1)
    const id = await project(A)
    await expect(link(id, 1, name)).rejects.toThrow(/check constraint/)
  })

  it.each([
    'octo/hello-world',
    'a/b',
    'My-Org1/some.repo_name',
    'octo/.github',
  ])('accepts the repository name %s', async (name) => {
    await install(A, 1)
    const id = await project(A)
    await expect(link(id, 1, name)).resolves.toBeDefined()
  })

  it('deleting the user still cascades to projects that were linked', async () => {
    await install(A, 1)
    const id = await project(A)
    await link(id, 1, 'alice/site')
    await db.exec(`delete from auth.users where id = '${A}'`)
    const rows = await db.query('select * from public.projects')
    expect(rows.rows).toEqual([])
  })
})
