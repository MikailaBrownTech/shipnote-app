import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const rateLimit = vi.fn()
const autoDraftsOn = vi.fn()
const aiIsEnabled = vi.fn()
const setAutoDraft = vi.fn()
const getProject = vi.fn()
const revalidatePath = vi.fn()
const notFound = vi.fn(() => {
  throw new Error('not-found')
})

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/server/rate-limit', () => ({ rateLimit }))
vi.mock('@/server/projects', () => ({ getProject }))
vi.mock('@/server/auto-drafts', () => ({ autoDraftsOn, setAutoDraft }))
vi.mock('@/server/draft-generation', () => ({ aiIsEnabled }))

const { setAutoDraftAction } = await import('./auto-draft-actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const IDLE = { status: 'idle' } as const

const form = (on: string | null) => {
  const data = new FormData()
  if (on !== null) data.set('on', on)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  autoDraftsOn.mockReturnValue(true)
  aiIsEnabled.mockReturnValue(true)
  rateLimit.mockResolvedValue(true)
  getProject.mockResolvedValue({
    ok: true,
    value: { id: ID, repoFullName: 'octo/hello', installationId: 42 },
  })
  setAutoDraft.mockResolvedValue('ok')
})

describe('the common rules', () => {
  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(setAutoDraftAction(ID, IDLE, form('true'))).rejects.toThrow(
      'redirect:/sign-in',
    )
    expect(setAutoDraft).not.toHaveBeenCalled()
  })

  it('is a not-found page while automatic drafts or AI are off', async () => {
    autoDraftsOn.mockReturnValue(false)
    await expect(setAutoDraftAction(ID, IDLE, form('true'))).rejects.toThrow(
      'not-found',
    )
    autoDraftsOn.mockReturnValue(true)
    aiIsEnabled.mockReturnValue(false)
    await expect(setAutoDraftAction(ID, IDLE, form('true'))).rejects.toThrow(
      'not-found',
    )
    expect(setAutoDraft).not.toHaveBeenCalled()
  })

  it('a malformed project id is a not-found page', async () => {
    await expect(
      setAutoDraftAction('../x', IDLE, form('true')),
    ).rejects.toThrow('not-found')
    expect(getProject).not.toHaveBeenCalled()
  })

  it('someone else’s project is a not-found page, and nothing is changed', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(setAutoDraftAction(ID, IDLE, form('true'))).rejects.toThrow(
      'not-found',
    )
    expect(setAutoDraft).not.toHaveBeenCalled()
    setAutoDraft.mockResolvedValue('not_found')
    getProject.mockResolvedValue({
      ok: true,
      value: { id: ID, repoFullName: 'a/b', installationId: 1 },
    })
    await expect(setAutoDraftAction(ID, IDLE, form('false'))).rejects.toThrow(
      'not-found',
    )
  })
})

describe('turning it on and off', () => {
  it('turns it on for the signed-in user’s own project and refreshes the page', async () => {
    expect(await setAutoDraftAction(ID, IDLE, form('true'))).toEqual({
      status: 'ok',
      on: true,
    })
    expect(setAutoDraft).toHaveBeenCalledExactlyOnceWith(USER, ID, true)
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${ID}`)
  })

  it('turns it off, even without a repository', async () => {
    getProject.mockResolvedValue({
      ok: true,
      value: { id: ID, repoFullName: null, installationId: null },
    })
    expect(await setAutoDraftAction(ID, IDLE, form('false'))).toEqual({
      status: 'ok',
      on: false,
    })
    expect(setAutoDraft).toHaveBeenCalledWith(USER, ID, false)
  })

  it('will not turn it on without a linked and connected repository', async () => {
    for (const value of [
      { id: ID, repoFullName: null, installationId: null },
      { id: ID, repoFullName: 'octo/hello', installationId: null },
    ]) {
      getProject.mockResolvedValue({ ok: true, value })
      expect(await setAutoDraftAction(ID, IDLE, form('true'))).toEqual({
        status: 'no_repo',
      })
    }
    expect(setAutoDraft).not.toHaveBeenCalled()
  })

  it.each([null, '', 'yes', '1', 'TRUE', 'on', 'true '])(
    'refuses the value %j',
    async (on) => {
      expect(await setAutoDraftAction(ID, IDLE, form(on))).toEqual({
        status: 'invalid',
      })
      expect(setAutoDraft).not.toHaveBeenCalled()
    },
  )

  it('never takes a user or project from the form', async () => {
    const data = form('true')
    data.set('userId', 'someone-else')
    data.set('project', 'other')
    await setAutoDraftAction(ID, IDLE, data)
    expect(setAutoDraft).toHaveBeenCalledWith(USER, ID, true)
  })

  it('is rate limited, and reports a failed write plainly', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await setAutoDraftAction(ID, IDLE, form('true'))).toEqual({
      status: 'limited',
    })
    expect(setAutoDraft).not.toHaveBeenCalled()
    rateLimit.mockResolvedValue(true)
    setAutoDraft.mockResolvedValue('failed')
    expect(await setAutoDraftAction(ID, IDLE, form('true'))).toEqual({
      status: 'failed',
    })
  })
})
