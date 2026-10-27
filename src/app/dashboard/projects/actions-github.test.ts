import { beforeEach, describe, expect, it, vi } from 'vitest'

// Creating a project that was started from a GitHub repo, and the secret check.

const requireUser = vi.fn()
const rateLimit = vi.fn()
const createProject = vi.fn()
const updateProject = vi.fn()
const githubIsEnabled = vi.fn()
const verifyRepoForLink = vi.fn()
const linkCreatedProject = vi.fn()
const revalidatePath = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})
const notFound = vi.fn(() => {
  throw new Error('not-found')
})

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect, notFound }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/github-app', () => ({ githubIsEnabled }))
vi.mock('@/server/github-import', () => ({
  verifyRepoForLink,
  linkCreatedProject,
}))
vi.mock('@/server/projects', () => ({
  createProject,
  updateProject,
  deleteProject: vi.fn(),
}))

const { createProjectAction, updateProjectAction } = await import('./actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const PATH = `/dashboard/projects/${ID}`
const idle = { status: 'idle' as const, errors: {}, values: null }

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
const good = {
  name: 'hello',
  summary: 'A greeting',
  stage: 'in_progress',
  notes: '# Hello',
}
const linked = {
  ...good,
  github_installation: '42',
  github_repo: 'octo/hello',
}
const cat = (...parts: string[]) => parts.join('')
const token = cat('gh', 'p', '_', 'aB3xY9'.repeat(6))

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  rateLimit.mockResolvedValue(true)
  githubIsEnabled.mockReturnValue(true)
  verifyRepoForLink.mockResolvedValue({
    status: 'ok',
    installationId: 42,
    repoFullName: 'octo/hello',
  })
  linkCreatedProject.mockResolvedValue(true)
  createProject.mockResolvedValue({ ok: true, value: { id: ID } })
  updateProject.mockResolvedValue({ ok: true, value: { id: ID } })
})

describe('create without a repository is unchanged', () => {
  it('saves and goes to the project, with no GitHub calls', async () => {
    await expect(createProjectAction(idle, form(good))).rejects.toThrow(
      `redirect:${PATH}`,
    )
    expect(verifyRepoForLink).not.toHaveBeenCalled()
    expect(linkCreatedProject).not.toHaveBeenCalled()
  })
})

describe('create from a GitHub repo', () => {
  it('verifies the repository, creates the project, then links it', async () => {
    await expect(createProjectAction(idle, form(linked))).rejects.toThrow(
      `redirect:${PATH}?github=linked`,
    )
    expect(verifyRepoForLink).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      installationId: 42,
      repoFullName: 'octo/hello',
    })
    expect(createProject).toHaveBeenCalledExactlyOnceWith(USER, {
      name: 'hello',
      summary: 'A greeting',
      stage: 'in_progress',
      notes: '# Hello',
    })
    expect(linkCreatedProject).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      projectId: ID,
      installationId: 42,
      repoFullName: 'octo/hello',
    })
  })

  it('stores the repository GitHub names, not the spelling the form sent', async () => {
    verifyRepoForLink.mockResolvedValue({
      status: 'ok',
      installationId: 42,
      repoFullName: 'Octo/Hello',
    })
    await expect(createProjectAction(idle, form(linked))).rejects.toThrow(
      'redirect:',
    )
    expect(linkCreatedProject).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'Octo/Hello' }),
    )
  })

  it('the link fields never reach the project data', async () => {
    await expect(createProjectAction(idle, form(linked))).rejects.toThrow(
      'redirect:',
    )
    expect(JSON.stringify(createProject.mock.calls)).not.toContain('github')
    expect(JSON.stringify(createProject.mock.calls)).not.toContain('octo/hello')
  })

  it('REJECTS a repository that is not on the installation’s list, and creates nothing', async () => {
    verifyRepoForLink.mockResolvedValue({ status: 'not_in_list' })
    const state = await createProjectAction(idle, form(linked))
    expect(state.status).toBe('repo')
    expect(createProject).not.toHaveBeenCalled()
    expect(linkCreatedProject).not.toHaveBeenCalled()
  })

  it('an installation that is not the user’s creates nothing', async () => {
    verifyRepoForLink.mockResolvedValue({ status: 'no_installation' })
    expect((await createProjectAction(idle, form(linked))).status).toBe('repo')
    expect(createProject).not.toHaveBeenCalled()
  })

  it('a repository already linked to another project creates nothing', async () => {
    verifyRepoForLink.mockResolvedValue({ status: 'already_linked' })
    expect((await createProjectAction(idle, form(linked))).status).toBe(
      'repo_taken',
    )
    expect(createProject).not.toHaveBeenCalled()
  })

  it.each(['rate_limited', 'unavailable'])(
    'GitHub %s creates nothing and says so',
    async (status) => {
      verifyRepoForLink.mockResolvedValue({ status })
      expect((await createProjectAction(idle, form(linked))).status).toBe(
        'repo_unavailable',
      )
      expect(createProject).not.toHaveBeenCalled()
    },
  )

  it('a failed check is a plain failure', async () => {
    verifyRepoForLink.mockResolvedValue({ status: 'failed' })
    expect((await createProjectAction(idle, form(linked))).status).toBe(
      'failed',
    )
    expect(createProject).not.toHaveBeenCalled()
  })

  it('still shows the 5-project cap error, and does not link', async () => {
    createProject.mockResolvedValue({ ok: false, reason: 'limit' })
    const state = await createProjectAction(idle, form(linked))
    expect(state.status).toBe('limit')
    expect(linkCreatedProject).not.toHaveBeenCalled()
  })

  it('keeps what was typed when the repository is refused', async () => {
    verifyRepoForLink.mockResolvedValue({ status: 'not_in_list' })
    const state = await createProjectAction(
      idle,
      form({ ...linked, notes: 'my edits' }),
    )
    expect(state.values?.notes).toBe('my edits')
  })

  it('if linking fails, the project still exists and the person is told', async () => {
    linkCreatedProject.mockResolvedValue(false)
    await expect(createProjectAction(idle, form(linked))).rejects.toThrow(
      `redirect:${PATH}?github=linkfailed`,
    )
    expect(createProject).toHaveBeenCalledOnce()
  })

  describe('the two link fields are checked', () => {
    it.each([
      ['only the installation', { github_installation: '42' }],
      ['only the repository', { github_repo: 'octo/hello' }],
      [
        'a non-numeric installation',
        { github_installation: '4x2', github_repo: 'octo/hello' },
      ],
      [
        'a negative installation',
        { github_installation: '-1', github_repo: 'octo/hello' },
      ],
      [
        'a huge installation',
        { github_installation: '9'.repeat(20), github_repo: 'octo/hello' },
      ],
      [
        'a path as the repository',
        { github_installation: '42', github_repo: '../../etc' },
      ],
      [
        'a repository with no owner',
        { github_installation: '42', github_repo: 'hello' },
      ],
      [
        'markup as the repository',
        { github_installation: '42', github_repo: '<b>/x' },
      ],
    ])(
      'refuses %s without calling GitHub or creating anything',
      async (_label, fields) => {
        const state = await createProjectAction(
          idle,
          form({ ...good, ...fields }),
        )
        expect(state.status).toBe('repo')
        expect(verifyRepoForLink).not.toHaveBeenCalled()
        expect(createProject).not.toHaveBeenCalled()
      },
    )
  })

  it('is refused while the GitHub feature is off', async () => {
    githubIsEnabled.mockReturnValue(false)
    const state = await createProjectAction(idle, form(linked))
    expect(state.status).toBe('repo')
    expect(verifyRepoForLink).not.toHaveBeenCalled()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('is rate limited before GitHub is asked', async () => {
    rateLimit.mockImplementation((name: string) =>
      Promise.resolve(name !== 'githubLink'),
    )
    const state = await createProjectAction(idle, form(linked))
    expect(state.status).toBe('limited')
    expect(verifyRepoForLink).not.toHaveBeenCalled()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('a validation error stops everything before GitHub is called', async () => {
    const state = await createProjectAction(idle, form({ ...linked, name: '' }))
    expect(state.status).toBe('invalid')
    expect(verifyRepoForLink).not.toHaveBeenCalled()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('takes the user from the session, never from the form', async () => {
    await expect(
      createProjectAction(idle, form({ ...linked, user_id: 'someone-else' })),
    ).resolves.toMatchObject({ status: 'invalid' })
    expect(createProject).not.toHaveBeenCalled()
  })
})

describe('the secret check blocks a save', () => {
  it('create: blocks notes that contain a key and says what kind and where', async () => {
    const state = await createProjectAction(
      idle,
      form({ ...linked, notes: cat('# Setup\n\nexport TOKEN=', token) }),
    )
    expect(state.status).toBe('invalid')
    expect(state.errors.notes).toContain('a GitHub token on line 3')
    expect(createProject).not.toHaveBeenCalled()
    // Nothing is verified or linked for a blocked save.
    expect(verifyRepoForLink).not.toHaveBeenCalled()
    expect(linkCreatedProject).not.toHaveBeenCalled()
  })

  it('the message never contains the secret', async () => {
    const state = await createProjectAction(
      idle,
      form({ ...good, notes: token }),
    )
    expect(JSON.stringify(state.errors)).not.toContain(token)
  })

  it('the person can edit it out and save', async () => {
    const blocked = await createProjectAction(
      idle,
      form({ ...linked, notes: cat('key ', token) }),
    )
    expect(blocked.status).toBe('invalid')
    await expect(
      createProjectAction(idle, form({ ...linked, notes: 'key (removed)' })),
    ).rejects.toThrow(`redirect:${PATH}?github=linked`)
  })

  it('update: blocks it too', async () => {
    const state = await updateProjectAction(
      ID,
      idle,
      form({ ...good, notes: cat('x ', token) }),
    )
    expect(state.status).toBe('invalid')
    expect(state.errors.notes).toContain('GitHub token')
    expect(updateProject).not.toHaveBeenCalled()
  })

  it('update: link fields are not accepted (unknown fields are refused)', async () => {
    const state = await updateProjectAction(ID, idle, form(linked))
    expect(state.status).toBe('invalid')
    expect(updateProject).not.toHaveBeenCalled()
  })
})
