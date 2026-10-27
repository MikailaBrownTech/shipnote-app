import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const rateLimit = vi.fn()
const createProject = vi.fn()
const updateProject = vi.fn()
const deleteProject = vi.fn()
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
vi.mock('@/server/projects', () => ({
  createProject,
  updateProject,
  deleteProject,
}))

const { createProjectAction, updateProjectAction, deleteProjectAction } =
  await import('./actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const idle = { status: 'idle' as const, errors: {}, values: null }
const deleteIdle = { status: 'idle' as const }

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
const good = { name: 'Shipnote', summary: '', stage: 'idea', notes: 'n' }
const saved = { name: 'Shipnote', summary: null, stage: 'idea', notes: 'n' }

describe('project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
    rateLimit.mockResolvedValue(true)
    createProject.mockResolvedValue({ ok: true, value: { id: ID } })
    updateProject.mockResolvedValue({ ok: true, value: { id: ID } })
    deleteProject.mockResolvedValue({ ok: true, value: null })
  })

  describe('create', () => {
    it('requires a user first: a signed-out caller is redirected and nothing is written', async () => {
      requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
      await expect(createProjectAction(idle, form(good))).rejects.toThrow(
        'redirect:/sign-in',
      )
      expect(createProject).not.toHaveBeenCalled()
    })

    it('creates the project for the session user and goes to it', async () => {
      await expect(createProjectAction(idle, form(good))).rejects.toThrow(
        `redirect:/dashboard/projects/${ID}`,
      )
      expect(createProject).toHaveBeenCalledExactlyOnceWith(USER, saved)
      expect(rateLimit).toHaveBeenCalledWith('projectCreate', USER)
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    })

    it('refuses a user_id in the form instead of using it', async () => {
      const state = await createProjectAction(
        idle,
        form({ ...good, user_id: 'someone-else' }),
      )
      expect(state.status).toBe('invalid')
      expect(createProject).not.toHaveBeenCalled()
    })

    it('returns field errors and keeps what was typed', async () => {
      const state = await createProjectAction(
        idle,
        form({ ...good, name: '', notes: 'keep me' }),
      )
      expect(state.status).toBe('invalid')
      expect(state.errors.name).toBeDefined()
      expect(state.values?.notes).toBe('keep me')
      expect(createProject).not.toHaveBeenCalled()
    })

    it('is stopped by the rate limit before anything is written', async () => {
      rateLimit.mockResolvedValue(false)
      const state = await createProjectAction(idle, form(good))
      expect(state.status).toBe('limited')
      expect(createProject).not.toHaveBeenCalled()
    })

    it('shows the 5-project limit', async () => {
      createProject.mockResolvedValue({ ok: false, reason: 'limit' })
      expect((await createProjectAction(idle, form(good))).status).toBe('limit')
    })

    it('returns a generic failure otherwise', async () => {
      createProject.mockResolvedValue({ ok: false, reason: 'failed' })
      expect((await createProjectAction(idle, form(good))).status).toBe(
        'failed',
      )
    })
  })

  describe('update', () => {
    it('updates by id for the session user', async () => {
      await expect(updateProjectAction(ID, idle, form(good))).rejects.toThrow(
        `redirect:/dashboard/projects/${ID}`,
      )
      expect(updateProject).toHaveBeenCalledExactlyOnceWith(USER, ID, saved)
      expect(rateLimit).toHaveBeenCalledWith('projectUpdate', USER)
    })

    it('a foreign or missing id gives the not-found page', async () => {
      updateProject.mockResolvedValue({ ok: false, reason: 'not_found' })
      await expect(updateProjectAction(ID, idle, form(good))).rejects.toThrow(
        'not-found',
      )
    })

    it('a malformed id gives the not-found page without touching the database', async () => {
      await expect(
        updateProjectAction('not-a-uuid', idle, form(good)),
      ).rejects.toThrow('not-found')
      expect(updateProject).not.toHaveBeenCalled()
    })

    it('rate limits and validates', async () => {
      rateLimit.mockResolvedValue(false)
      expect((await updateProjectAction(ID, idle, form(good))).status).toBe(
        'limited',
      )
      rateLimit.mockResolvedValue(true)
      expect(
        (await updateProjectAction(ID, idle, form({ ...good, stage: 'x' })))
          .status,
      ).toBe('invalid')
      expect(updateProject).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('does nothing without the confirmation', async () => {
      expect(await deleteProjectAction(ID, deleteIdle, form({}))).toEqual({
        status: 'failed',
      })
      expect(deleteProject).not.toHaveBeenCalled()
    })

    it('deletes after confirmation and returns to the dashboard', async () => {
      await expect(
        deleteProjectAction(ID, deleteIdle, form({ confirm: 'yes' })),
      ).rejects.toThrow('redirect:/dashboard')
      expect(deleteProject).toHaveBeenCalledExactlyOnceWith(USER, ID)
    })

    it('a foreign or missing id gives the not-found page', async () => {
      deleteProject.mockResolvedValue({ ok: false, reason: 'not_found' })
      await expect(
        deleteProjectAction(ID, deleteIdle, form({ confirm: 'yes' })),
      ).rejects.toThrow('not-found')
    })

    it('requires a user first', async () => {
      requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
      await expect(
        deleteProjectAction(ID, deleteIdle, form({ confirm: 'yes' })),
      ).rejects.toThrow('redirect:/sign-in')
      expect(deleteProject).not.toHaveBeenCalled()
    })
  })
})
