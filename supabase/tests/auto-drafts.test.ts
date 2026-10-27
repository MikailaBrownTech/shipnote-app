import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, createDb, type Db } from './db'

let db: Db

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const DELIVERY = '11111111-aaaa-4bbb-8ccc-222222222222'
const DELIVERY2 = '33333333-aaaa-4bbb-8ccc-444444444444'

beforeAll(async () => {
  db = await createDb()
}, 60_000)

let projectA = ''
let projectB = ''

beforeEach(async () => {
  await db.exec('delete from auth.users;')
  await db.exec('delete from public.webhook_deliveries;')
  await db.exec(`
    insert into auth.users (id, email) values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
  `)
  projectA = await linkedProject(A, 101, 'octo/alpha')
  projectB = await linkedProject(B, 202, 'other/beta')
})

async function linkedProject(user: string, installation: number, repo: string) {
  await db.query(
    `insert into public.github_installations (user_id, installation_id, account_login, account_id)
     values ($1, $2, 'login', $2)`,
    [user, installation],
  )
  const project = await db.query<{ id: string }>(
    `insert into public.projects (user_id, name, stage, installation_id, repo_full_name, auto_draft)
     values ($1, 'P', 'idea', $2, $3, true) returning id`,
    [user, installation, repo],
  )
  return project.rows[0]?.id ?? ''
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

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toThrow(/permission denied|must be owner|row-level/i)

function createJob(
  user: string,
  project: string,
  sha = SHA1,
  delivery = DELIVERY,
) {
  return service(() =>
    db.query<{ id: string | null }>(
      'select public.create_auto_draft_job($1, $2, $3, $4) as id',
      [user, project, sha, delivery],
    ),
  ).then((r) => r.rows[0]?.id ?? null)
}

function claim(user: string, project: string, sha = SHA1) {
  return service(() =>
    db.query<{ id: string | null }>(
      'select public.claim_auto_draft_job($1, $2, $3) as id',
      [user, project, sha],
    ),
  ).then((r) => r.rows[0]?.id ?? null)
}

function finish(
  job: string,
  user: string,
  status: string,
  reason: string | null = null,
  draft: string | null = null,
) {
  return service(() =>
    db.query<{ ok: boolean }>(
      'select public.finish_auto_draft_job($1, $2, $3, $4, $5) as ok',
      [job, user, status, reason, draft],
    ),
  ).then((r) => r.rows[0]?.ok)
}

const row = (job: string) =>
  db
    .query<{ status: string; reason: string | null; draft_id: string | null }>(
      'select status, reason, draft_id from public.auto_draft_jobs where id = $1',
      [job],
    )
    .then((r) => r.rows[0])

async function draftFor(user: string, project: string) {
  const usage = await service(() =>
    db.query<{ id: string }>(
      'select public.reserve_generation($1, 1000, 10, 10000000) as id',
      [user],
    ),
  )
  const made = await service(() =>
    db.query<{ id: string }>(
      `select public.complete_generation($1, $2, $3, 'A draft.', 'claude-sonnet-5-5', 1, 1, 1, $4) as id`,
      [usage.rows[0]?.id, user, project, [SHA1]],
    ),
  )
  return made.rows[0]?.id ?? ''
}

describe('the auto_draft switch', () => {
  it('defaults to off for a new project', async () => {
    const created = await db.query<{ auto_draft: boolean }>(
      `insert into public.projects (user_id, name, stage) values ($1, 'New', 'idea') returning auto_draft`,
      [A],
    )
    expect(created.rows[0]?.auto_draft).toBe(false)
  })

  it('the owner can flip their own switch, and only theirs', async () => {
    const own = await asUser(A, () =>
      db.query('update public.projects set auto_draft = false where id = $1', [
        projectA,
      ]),
    )
    expect(own.affectedRows).toBe(1)
    const other = await asUser(A, () =>
      db.query('update public.projects set auto_draft = false where id = $1', [
        projectB,
      ]),
    )
    expect(other.affectedRows).toBe(0)
    const still = await db.query<{ auto_draft: boolean }>(
      'select auto_draft from public.projects where id = $1',
      [projectB],
    )
    expect(still.rows[0]?.auto_draft).toBe(true)
  })

  it('a user still cannot change the link columns', async () => {
    await denied(
      asUser(A, () =>
        db.query(
          "update public.projects set repo_full_name = 'evil/repo' where id = $1",
          [projectA],
        ),
      ),
    )
  })

  it('changing the linked repository turns it off', async () => {
    await service(() =>
      db.query(
        "update public.projects set repo_full_name = 'octo/other' where id = $1",
        [projectA],
      ),
    )
    const after = await db.query<{ auto_draft: boolean }>(
      'select auto_draft from public.projects where id = $1',
      [projectA],
    )
    expect(after.rows[0]?.auto_draft).toBe(false)
  })

  it('unlinking turns it off, and editing other fields does not', async () => {
    await asUser(A, () =>
      db.query("update public.projects set notes = 'changed' where id = $1", [
        projectA,
      ]),
    )
    let state = await db.query<{ auto_draft: boolean }>(
      'select auto_draft from public.projects where id = $1',
      [projectA],
    )
    expect(state.rows[0]?.auto_draft).toBe(true)
    await service(() =>
      db.query(
        'update public.projects set installation_id = null, repo_full_name = null where id = $1',
        [projectA],
      ),
    )
    state = await db.query<{ auto_draft: boolean }>(
      'select auto_draft from public.projects where id = $1',
      [projectA],
    )
    expect(state.rows[0]?.auto_draft).toBe(false)
  })
})

describe('webhook_deliveries', () => {
  const record = (id: string, installation = 101) =>
    service(() =>
      db.query<{ r: string }>(
        'select public.record_webhook_delivery($1, $2) as r',
        [id, installation],
      ),
    ).then((x) => x.rows[0]?.r)

  it.each(['authenticated', 'anon'])(
    '%s cannot read or write the table',
    async (role) => {
      await record(DELIVERY)
      await denied(
        asRole(db, role, () =>
          db.query('select * from public.webhook_deliveries'),
        ),
      )
      await denied(
        asRole(db, role, () =>
          db.query(
            "insert into public.webhook_deliveries (delivery_id) values ('abcdefgh-1')",
          ),
        ),
      )
      await denied(
        asRole(db, role, () =>
          db.query('delete from public.webhook_deliveries'),
        ),
      )
    },
  )

  it('records a delivery once: new, then retry until finished, then duplicate', async () => {
    expect(await record(DELIVERY)).toBe('new')
    expect(await record(DELIVERY)).toBe('retry')
    await service(() =>
      db.query('select public.finish_webhook_delivery($1)', [DELIVERY]),
    )
    expect(await record(DELIVERY)).toBe('duplicate')
    expect(await record(DELIVERY2)).toBe('new')
  })

  it('a burst of the same delivery id yields exactly one new', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => record(DELIVERY)),
    )
    expect(results.filter((r) => r === 'new')).toHaveLength(1)
    const rows = await db.query('select 1 from public.webhook_deliveries')
    expect(rows.rows).toHaveLength(1)
  })

  it.each([
    '',
    'short',
    'has space in it here',
    'a'.repeat(65),
    "x'; drop table--",
  ])('refuses the malformed id %j', async (id) => {
    await expect(record(id)).rejects.toMatchObject({ code: 'SN032' })
  })

  it('no user role can call the functions', async () => {
    await denied(
      asUser(A, () =>
        db.query("select public.record_webhook_delivery('abcdefgh-1', 1)"),
      ),
    )
    await denied(
      asRole(db, 'anon', () =>
        db.query("select public.finish_webhook_delivery('abcdefgh-1')"),
      ),
    )
  })
})

describe('resolve_auto_draft_target', () => {
  const resolve = (installation: number, repo: string) =>
    service(() =>
      db.query<{ user_id: string; project_id: string }>(
        'select * from public.resolve_auto_draft_target($1, $2)',
        [installation, repo],
      ),
    ).then((r) => r.rows)

  it('finds the project from the installation and the repository, ignoring case', async () => {
    expect(await resolve(101, 'Octo/Alpha')).toEqual([
      { user_id: A, project_id: projectA },
    ])
  })

  it('takes the user from the installation row, so a repository of another user finds nothing', async () => {
    expect(await resolve(101, 'other/beta')).toEqual([])
    expect(await resolve(202, 'octo/alpha')).toEqual([])
  })

  it('finds nothing when the switch is off, the project is unlinked, or the installation is unknown', async () => {
    await asUser(A, () =>
      db.query('update public.projects set auto_draft = false where id = $1', [
        projectA,
      ]),
    )
    expect(await resolve(101, 'octo/alpha')).toEqual([])
    expect(await resolve(999, 'octo/alpha')).toEqual([])
  })

  it('finds nothing for a soft-deleted account', async () => {
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    expect(await resolve(101, 'octo/alpha')).toEqual([])
  })

  it('no user role can call it', async () => {
    await denied(
      asUser(A, () =>
        db.query(
          "select * from public.resolve_auto_draft_target(101, 'octo/alpha')",
        ),
      ),
    )
  })
})

describe('creating jobs', () => {
  it('creates one job per commit, whatever the delivery', async () => {
    const first = await createJob(A, projectA)
    expect(first).toBeTruthy()
    expect(await createJob(A, projectA, SHA1, DELIVERY2)).toBeNull()
    expect(await createJob(A, projectA, SHA2)).toBeTruthy()
    const rows = await db.query('select 1 from public.auto_draft_jobs')
    expect(rows.rows).toHaveLength(2)
  })

  it('a burst for the same commit creates exactly one job', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => createJob(A, projectA)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('the same sha in two projects is two jobs', async () => {
    expect(await createJob(A, projectA)).toBeTruthy()
    expect(await createJob(B, projectB)).toBeTruthy()
  })

  it('starts queued with no reason', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    expect(await row(id)).toEqual({
      status: 'queued',
      reason: null,
      draft_id: null,
    })
  })

  it('makes no job for a project that is not the user’s, has the switch off, or is deleted', async () => {
    expect(await createJob(A, projectB)).toBeNull()
    await asUser(A, () =>
      db.query('update public.projects set auto_draft = false where id = $1', [
        projectA,
      ]),
    )
    expect(await createJob(A, projectA)).toBeNull()
    await db.exec(`update auth.users set deleted_at = now() where id = '${B}'`)
    expect(await createJob(B, projectB)).toBeNull()
  })

  it.each([
    ['a short sha', 'abc1234'],
    ['an uppercase sha', 'A'.repeat(40)],
    ['a non-hex sha', 'g'.repeat(40)],
    ['an injected sha', `${'a'.repeat(39)}'`],
  ])('refuses %s', async (_label, sha) => {
    await expect(createJob(A, projectA, sha)).rejects.toMatchObject({
      code: 'SN032',
    })
  })

  it('refuses a malformed delivery id', async () => {
    await expect(createJob(A, projectA, SHA1, 'bad id!')).rejects.toMatchObject(
      { code: 'SN032' },
    )
  })

  it('a job that failed only because it could not be queued can be queued again', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await finish(id, A, 'failed', 'queue_unavailable')
    expect(await createJob(A, projectA, SHA1, DELIVERY2)).toBe(id)
    expect((await row(id))?.status).toBe('queued')
  })

  it('other failed or finished jobs are never re-armed', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await claim(A, projectA)
    await finish(id, A, 'failed', 'commit_not_found')
    expect(await createJob(A, projectA, SHA1, DELIVERY2)).toBeNull()
    expect((await row(id))?.status).toBe('failed')
  })
})

describe('claiming jobs', () => {
  it('queued becomes running, once', async () => {
    const id = await createJob(A, projectA)
    expect(await claim(A, projectA)).toBe(id)
    expect(await claim(A, projectA)).toBeNull()
    expect((await row(id ?? ''))?.status).toBe('running')
  })

  it('a burst of claims gives exactly one winner', async () => {
    await createJob(A, projectA)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claim(A, projectA)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('another user cannot claim a job, or one that does not exist', async () => {
    await createJob(A, projectA)
    expect(await claim(B, projectA)).toBeNull()
    expect(await claim(A, projectA, SHA2)).toBeNull()
    expect(
      (
        await db.query<{ status: string }>(
          'select status from public.auto_draft_jobs',
        )
      ).rows[0]?.status,
    ).toBe('queued')
  })

  it('a job left running for ten minutes can be claimed again, a fresh one cannot', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await claim(A, projectA)
    expect(await claim(A, projectA)).toBeNull()
    await db.query(
      "update public.auto_draft_jobs set started_at = now() - interval '11 minutes' where id = $1",
      [id],
    )
    expect(await claim(A, projectA)).toBe(id)
  })

  it('a deleted account’s job is ended as skipped and not claimed', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    expect(await claim(A, projectA)).toBeNull()
    expect(await row(id)).toMatchObject({
      status: 'skipped',
      reason: 'account_inactive',
    })
  })

  it('release puts a running job back to queued, and only for its owner', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await claim(A, projectA)
    const wrong = await service(() =>
      db.query<{ ok: boolean }>(
        'select public.release_auto_draft_job($1, $2) as ok',
        [id, B],
      ),
    )
    expect(wrong.rows[0]?.ok).toBe(false)
    const right = await service(() =>
      db.query<{ ok: boolean }>(
        'select public.release_auto_draft_job($1, $2) as ok',
        [id, A],
      ),
    )
    expect(right.rows[0]?.ok).toBe(true)
    expect(await claim(A, projectA)).toBe(id)
  })
})

describe('finishing jobs', () => {
  it('done keeps the draft, skipped and failed keep a fixed reason', async () => {
    const a = (await createJob(A, projectA, SHA1)) ?? ''
    const b = (await createJob(A, projectA, SHA2)) ?? ''
    await claim(A, projectA, SHA1)
    const draft = await draftFor(A, projectA)
    expect(await finish(a, A, 'done', null, draft)).toBe(true)
    expect(await row(a)).toEqual({
      status: 'done',
      reason: null,
      draft_id: draft,
    })
    await claim(A, projectA, SHA2)
    expect(await finish(b, A, 'skipped', 'daily_limit')).toBe(true)
    expect(await row(b)).toMatchObject({
      status: 'skipped',
      reason: 'daily_limit',
    })
  })

  it('a finished job cannot be changed again', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await claim(A, projectA)
    await finish(id, A, 'skipped', 'daily_limit')
    for (const status of ['done', 'failed', 'skipped']) {
      expect(await finish(id, A, status, 'x')).toBe(false)
    }
    expect(await row(id)).toMatchObject({
      status: 'skipped',
      reason: 'daily_limit',
    })
  })

  it('another user cannot finish my job', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    expect(await finish(id, B, 'failed', 'x')).toBe(false)
    expect((await row(id))?.status).toBe('queued')
  })

  it('refuses an unknown status and a reason that is not a short fixed code', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await expect(finish(id, A, 'running')).rejects.toMatchObject({
      code: 'SN032',
    })
    await expect(
      finish(id, A, 'failed', 'Some Text From A Commit'),
    ).rejects.toMatchObject({ code: 'SN032' })
    await expect(finish(id, A, 'failed', 'x'.repeat(41))).rejects.toMatchObject(
      { code: 'SN032' },
    )
  })

  it('a job cannot point at another user’s draft', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await claim(A, projectA)
    const theirs = await draftFor(B, projectB)
    await expect(finish(id, A, 'done', null, theirs)).rejects.toThrow()
  })
})

describe('who can see jobs', () => {
  it('a user reads only their own jobs', async () => {
    const a = (await createJob(A, projectA)) ?? ''
    await createJob(B, projectB)
    const seen = await asUser(A, () =>
      db.query<{ id: string }>('select id from public.auto_draft_jobs'),
    )
    expect(seen.rows).toEqual([{ id: a }])
  })

  it('a user cannot insert, update or delete jobs', async () => {
    await createJob(A, projectA)
    await denied(
      asUser(A, () =>
        db.query(
          `insert into public.auto_draft_jobs (user_id, project_id, commit_sha) values ('${A}', '${projectA}', '${SHA2}')`,
        ),
      ),
    )
    await denied(
      asUser(A, () =>
        db.query("update public.auto_draft_jobs set status = 'done'"),
      ),
    )
    await denied(
      asUser(A, () => db.query('delete from public.auto_draft_jobs')),
    )
  })

  it('anon sees and changes nothing', async () => {
    await createJob(A, projectA)
    await denied(
      asRole(db, 'anon', () =>
        db.query('select * from public.auto_draft_jobs'),
      ),
    )
  })

  it('a soft-deleted account sees nothing', async () => {
    await createJob(A, projectA)
    await db.exec(`update auth.users set deleted_at = now() where id = '${A}'`)
    const seen = await asUser(A, () =>
      db.query('select * from public.auto_draft_jobs'),
    )
    expect(seen.rows).toEqual([])
  })

  it('no user role can call the job functions', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    for (const sql of [
      `select public.create_auto_draft_job('${A}', '${projectA}', '${SHA2}', '${DELIVERY}')`,
      `select public.claim_auto_draft_job('${A}', '${projectA}', '${SHA1}')`,
      `select public.release_auto_draft_job('${id}', '${A}')`,
      `select public.finish_auto_draft_job('${id}', '${A}', 'failed', 'x', null)`,
      `select * from public.read_project_for_auto_draft('${A}', '${projectA}')`,
    ]) {
      await denied(asUser(A, () => db.query(sql)))
      await denied(asRole(db, 'anon', () => db.query(sql)))
    }
  })
})

describe('read_project_for_auto_draft', () => {
  const read = (user: string, project: string) =>
    service(() =>
      db.query<Record<string, unknown>>(
        'select * from public.read_project_for_auto_draft($1, $2)',
        [user, project],
      ),
    ).then((r) => r.rows)

  it('returns the fields the worker needs for the owner’s project', async () => {
    const rows = await read(A, projectA)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'P',
      stage: 'idea',
      repo_full_name: 'octo/alpha',
    })
    expect(Number(rows[0]?.installation_id)).toBe(101)
  })

  it('returns nothing for another user’s project, with the switch off, unlinked, or for a deleted account', async () => {
    expect(await read(A, projectB)).toEqual([])
    await asUser(A, () =>
      db.query('update public.projects set auto_draft = false where id = $1', [
        projectA,
      ]),
    )
    expect(await read(A, projectA)).toEqual([])
    await db.exec(`update auth.users set deleted_at = now() where id = '${B}'`)
    expect(await read(B, projectB)).toEqual([])
  })
})

describe('deleting things', () => {
  it('deleting a project removes its jobs', async () => {
    await createJob(A, projectA)
    await createJob(B, projectB)
    await db.query('delete from public.projects where id = $1', [projectA])
    const left = await db.query<{ user_id: string }>(
      'select user_id from public.auto_draft_jobs',
    )
    expect(left.rows).toEqual([{ user_id: B }])
  })

  it('deleting a draft keeps its job', async () => {
    const id = (await createJob(A, projectA)) ?? ''
    await claim(A, projectA)
    const draft = await draftFor(A, projectA)
    await finish(id, A, 'done', null, draft)
    await db.query('delete from public.drafts where id = $1', [draft])
    expect(await row(id)).toEqual({
      status: 'done',
      reason: null,
      draft_id: null,
    })
  })

  it('deleting a user removes their jobs and no one else’s', async () => {
    await createJob(A, projectA)
    await createJob(B, projectB)
    await db.exec(`delete from auth.users where id = '${A}'`)
    const left = await db.query<{ user_id: string }>(
      'select user_id from public.auto_draft_jobs',
    )
    expect(left.rows).toEqual([{ user_id: B }])
  })
})
