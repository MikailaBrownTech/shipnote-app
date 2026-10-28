import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const rateLimit = vi.fn()
const schedulingIsEnabled = vi.fn()
const beginConnect = vi.fn()
const disconnectBuffer = vi.fn()
const channelsFor = vi.fn()
const scheduleDraft = vi.fn()
const cancelSchedule = vi.fn()
const refreshStatuses = vi.fn()
const getProject = vi.fn()
const getDraft = vi.fn()
const getScheduledPost = vi.fn()
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
vi.mock('@/server/projects', () => ({ getProject }))
vi.mock('@/server/drafts', () => ({ getDraft }))
vi.mock('@/server/scheduled-posts', () => ({ getScheduledPost }))
vi.mock('@/server/scheduling', () => ({
  beginConnect,
  bodyHash: (body: string) => `hash-of-${body}`.padEnd(64, '0'),
  cancelSchedule,
  channelsFor,
  disconnectBuffer,
  refreshStatuses,
  scheduleDraft,
  schedulingIsEnabled,
}))

const {
  cancelScheduleAction,
  confirmScheduleAction,
  connectBufferAction,
  disconnectBufferAction,
  refreshStatusAction,
  startReviewAction,
} = await import('./actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const DRAFT = '99999999-2222-4333-8444-555555555555'
const SCHEDULE = '77777777-2222-4333-8444-555555555555'
const HASH = 'a'.repeat(64)
const IDLE = { status: 'idle' } as const

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
const confirmForm = (over: Record<string, string> = {}) =>
  form({
    channel: 'chan-1',
    local: '2026-11-10T09:30',
    timezone: 'America/New_York',
    hash: HASH,
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  schedulingIsEnabled.mockReturnValue(true)
  rateLimit.mockResolvedValue(true)
  beginConnect.mockResolvedValue('https://auth.buffer.com/auth?x=1')
  disconnectBuffer.mockResolvedValue({
    ok: true,
    canceled: 0,
    couldNotCancel: 0,
  })
  getProject.mockResolvedValue({
    ok: true,
    value: { id: PROJECT, stage: 'in_progress' },
  })
  getDraft.mockResolvedValue({
    id: DRAFT,
    projectId: PROJECT,
    body: 'Saved text',
  })
  getScheduledPost.mockResolvedValue({ id: SCHEDULE })
  channelsFor.mockResolvedValue({
    ok: true,
    channels: [{ id: 'chan-1', label: 'Me' }],
  })
  scheduleDraft.mockResolvedValue({
    ok: true,
    id: SCHEDULE,
    scheduledFor: '2026-11-10T14:30:00.000Z',
  })
  cancelSchedule.mockResolvedValue('canceled')
  refreshStatuses.mockResolvedValue({ ok: true, updated: 1 })
})

describe.each([
  ['connect', () => connectBufferAction(form({}))],
  ['disconnect', () => disconnectBufferAction(form({}))],
  ['review', () => startReviewAction(PROJECT, DRAFT)],
  ['confirm', () => confirmScheduleAction(PROJECT, DRAFT, IDLE, confirmForm())],
  ['cancel', () => cancelScheduleAction(PROJECT, SCHEDULE)],
  ['refresh', () => refreshStatusAction(PROJECT)],
])('%s: the common rules', (_name, run) => {
  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(run()).rejects.toThrow('redirect:/sign-in')
    expect(beginConnect).not.toHaveBeenCalled()
    expect(scheduleDraft).not.toHaveBeenCalled()
    expect(cancelSchedule).not.toHaveBeenCalled()
    expect(disconnectBuffer).not.toHaveBeenCalled()
  })

  it('is a not-found page while scheduling is off (the kill switch)', async () => {
    schedulingIsEnabled.mockReturnValue(false)
    await expect(run()).rejects.toThrow('not-found')
    expect(beginConnect).not.toHaveBeenCalled()
    expect(channelsFor).not.toHaveBeenCalled()
    expect(scheduleDraft).not.toHaveBeenCalled()
    expect(cancelSchedule).not.toHaveBeenCalled()
    expect(refreshStatuses).not.toHaveBeenCalled()
    expect(disconnectBuffer).not.toHaveBeenCalled()
  })
})

describe('connect', () => {
  it('sends the person to the URL the server built', async () => {
    await expect(connectBufferAction(form({}))).rejects.toThrow(
      'redirect:https://auth.buffer.com/auth?x=1',
    )
    expect(beginConnect).toHaveBeenCalledExactlyOnceWith(USER, null)
  })

  it('remembers the project and draft only if they are the person’s own', async () => {
    await expect(
      connectBufferAction(form({ project: PROJECT, draft: DRAFT })),
    ).rejects.toThrow('redirect:https')
    expect(beginConnect).toHaveBeenCalledWith(USER, {
      projectId: PROJECT,
      draftId: DRAFT,
    })
  })

  it('drops a project that is not theirs, and a draft from another project', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(
      connectBufferAction(form({ project: PROJECT, draft: DRAFT })),
    ).rejects.toThrow('redirect:https')
    expect(beginConnect).toHaveBeenLastCalledWith(USER, null)
    getProject.mockResolvedValue({ ok: true, value: { id: PROJECT } })
    getDraft.mockResolvedValue({
      id: DRAFT,
      projectId: 'another-project',
      body: 'x',
    })
    await expect(
      connectBufferAction(form({ project: PROJECT, draft: DRAFT })),
    ).rejects.toThrow('redirect:https')
    expect(beginConnect).toHaveBeenLastCalledWith(USER, {
      projectId: PROJECT,
      draftId: null,
    })
  })

  it('ignores a malformed project or draft id', async () => {
    await expect(
      connectBufferAction(form({ project: '../../x', draft: 'nope' })),
    ).rejects.toThrow('redirect:https')
    expect(beginConnect).toHaveBeenCalledWith(USER, null)
    expect(getProject).not.toHaveBeenCalled()
  })

  it('is rate limited before any state is set', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(connectBufferAction(form({}))).rejects.toThrow(
      'redirect:/dashboard?buffer=limited',
    )
    expect(beginConnect).not.toHaveBeenCalled()
  })

  it('a missing authorization URL is a not-found page', async () => {
    beginConnect.mockResolvedValue(null)
    await expect(connectBufferAction(form({}))).rejects.toThrow('not-found')
  })
})

describe('disconnect', () => {
  it('without the box ticked, does not cancel first', async () => {
    await expect(disconnectBufferAction(form({}))).rejects.toThrow(
      'redirect:/dashboard?buffer=disconnected',
    )
    expect(disconnectBuffer).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      cancelFirst: false,
    })
  })

  it('with the box ticked, cancels first', async () => {
    await expect(
      disconnectBufferAction(form({ cancel_first: 'on' })),
    ).rejects.toThrow('buffer=disconnected')
    expect(disconnectBuffer).toHaveBeenCalledWith({
      userId: USER,
      cancelFirst: true,
    })
  })

  it('says so when some posts could not be cancelled', async () => {
    disconnectBuffer.mockResolvedValue({
      ok: true,
      canceled: 1,
      couldNotCancel: 2,
    })
    await expect(
      disconnectBufferAction(form({ cancel_first: 'on' })),
    ).rejects.toThrow('buffer=disconnected_posts')
  })

  it('a failure to delete is reported as failed', async () => {
    disconnectBuffer.mockResolvedValue({
      ok: false,
      canceled: 0,
      couldNotCancel: 0,
    })
    await expect(disconnectBufferAction(form({}))).rejects.toThrow(
      'buffer=failed',
    )
  })

  it('only ever acts on the signed-in user, whatever the form says', async () => {
    await expect(
      disconnectBufferAction(form({ userId: 'someone-else', user_id: 'x' })),
    ).rejects.toThrow('redirect')
    expect(disconnectBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
    )
  })

  it('is rate limited', async () => {
    rateLimit.mockResolvedValue(false)
    await expect(disconnectBufferAction(form({}))).rejects.toThrow(
      'buffer=limited',
    )
    expect(disconnectBuffer).not.toHaveBeenCalled()
  })
})

describe('the review step', () => {
  it('returns the saved text, its hash, the warnings and the person’s channels, and schedules nothing', async () => {
    const result = await startReviewAction(PROJECT, DRAFT)
    expect(result).toMatchObject({
      status: 'ok',
      draftId: DRAFT,
      text: 'Saved text',
      hash: `hash-of-Saved text`.padEnd(64, '0'),
      channels: [{ id: 'chan-1', label: 'Me' }],
    })
    expect(scheduleDraft).not.toHaveBeenCalled()
    expect(channelsFor).toHaveBeenCalledWith(USER)
  })

  it('a draft that is not theirs, or is from another project, is not found', async () => {
    getDraft.mockResolvedValue('not_found')
    expect(await startReviewAction(PROJECT, DRAFT)).toEqual({
      status: 'not_found',
    })
    getDraft.mockResolvedValue({ id: DRAFT, projectId: 'other', body: 'x' })
    expect(await startReviewAction(PROJECT, DRAFT)).toEqual({
      status: 'not_found',
    })
    expect(channelsFor).not.toHaveBeenCalled()
  })

  it('a malformed draft id is not found and a malformed project id is a not-found page', async () => {
    expect(await startReviewAction(PROJECT, 'nope')).toEqual({
      status: 'not_found',
    })
    await expect(startReviewAction('nope', DRAFT)).rejects.toThrow('not-found')
  })

  it.each(['needs_reconnect', 'rate_limited', 'unavailable'])(
    'a %s from Buffer is passed on',
    async (reason) => {
      channelsFor.mockResolvedValue({ ok: false, reason })
      expect(await startReviewAction(PROJECT, DRAFT)).toEqual({
        status: reason,
      })
    },
  )

  it('no LinkedIn channels is its own message', async () => {
    channelsFor.mockResolvedValue({ ok: true, channels: [] })
    expect(await startReviewAction(PROJECT, DRAFT)).toEqual({
      status: 'no_channels',
    })
  })

  it('is rate limited', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await startReviewAction(PROJECT, DRAFT)).toEqual({
      status: 'limited',
    })
    expect(channelsFor).not.toHaveBeenCalled()
  })
})

describe('confirm', () => {
  it('schedules once, for the signed-in user, with the reviewed hash', async () => {
    const result = await confirmScheduleAction(
      PROJECT,
      DRAFT,
      IDLE,
      confirmForm(),
    )
    expect(result).toEqual({
      status: 'scheduled',
      id: SCHEDULE,
      scheduledFor: '2026-11-10T14:30:00.000Z',
    })
    expect(scheduleDraft).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      draftId: DRAFT,
      reviewedHash: HASH,
      channelId: 'chan-1',
      local: '2026-11-10T09:30',
      timeZone: 'America/New_York',
    })
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/projects/${PROJECT}`,
    )
  })

  it('never takes the text or a user id from the form', async () => {
    await confirmScheduleAction(
      PROJECT,
      DRAFT,
      IDLE,
      confirmForm({ text: 'smuggled', body: 'smuggled', userId: 'x' }),
    )
    expect(JSON.stringify(scheduleDraft.mock.calls)).not.toContain('smuggled')
    expect(scheduleDraft).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
    )
  })

  it.each([
    ['no hash', { hash: '' }],
    ['a short hash', { hash: 'abc' }],
    ['an uppercase hash', { hash: 'A'.repeat(64) }],
    ['no channel', { channel: '' }],
    ['a huge channel id', { channel: 'c'.repeat(201) }],
    ['a huge time', { local: 'x'.repeat(21) }],
    ['a huge zone', { timezone: 'z'.repeat(65) }],
  ])('%s is invalid and nothing is scheduled', async (_label, over) => {
    expect(
      await confirmScheduleAction(PROJECT, DRAFT, IDLE, confirmForm(over)),
    ).toEqual({ status: 'invalid' })
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  it('a malformed draft id is refused as not found', async () => {
    expect(
      await confirmScheduleAction(PROJECT, 'nope', IDLE, confirmForm()),
    ).toEqual({ status: 'refused', reason: 'not_found' })
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  it('a project that is not theirs is a not-found page', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(
      confirmScheduleAction(PROJECT, DRAFT, IDLE, confirmForm()),
    ).rejects.toThrow('not-found')
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  it('is rate limited before anything is scheduled', async () => {
    rateLimit.mockResolvedValue(false)
    expect(
      await confirmScheduleAction(PROJECT, DRAFT, IDLE, confirmForm()),
    ).toEqual({ status: 'limited' })
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  it.each([
    'text_changed',
    'daily_limit',
    'already_scheduled',
    'unknown_result',
    'plan_limit',
    'too_soon',
    'needs_reconnect',
  ])('a %s refusal is passed on as a code', async (reason) => {
    scheduleDraft.mockResolvedValue({ ok: false, reason })
    expect(
      await confirmScheduleAction(PROJECT, DRAFT, IDLE, confirmForm()),
    ).toEqual({ status: 'refused', reason })
  })

  it('works only through the Confirm action: opening the review schedules nothing', async () => {
    await startReviewAction(PROJECT, DRAFT)
    await startReviewAction(PROJECT, DRAFT)
    expect(scheduleDraft).not.toHaveBeenCalled()
  })
})

describe('cancel', () => {
  it('cancels the person’s own schedule', async () => {
    expect(await cancelScheduleAction(PROJECT, SCHEDULE)).toEqual({
      status: 'ok',
      result: 'canceled',
    })
    expect(cancelSchedule).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      id: SCHEDULE,
    })
  })

  it('shows that Buffer already published it', async () => {
    cancelSchedule.mockResolvedValue('published')
    expect(await cancelScheduleAction(PROJECT, SCHEDULE)).toEqual({
      status: 'ok',
      result: 'published',
    })
  })

  it('someone else’s or a malformed schedule is not found, and nothing is called', async () => {
    getScheduledPost.mockResolvedValue('not_found')
    expect(await cancelScheduleAction(PROJECT, SCHEDULE)).toEqual({
      status: 'not_found',
    })
    expect(await cancelScheduleAction(PROJECT, 'nope')).toEqual({
      status: 'not_found',
    })
    expect(cancelSchedule).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await cancelScheduleAction(PROJECT, SCHEDULE)).toEqual({
      status: 'limited',
    })
    expect(cancelSchedule).not.toHaveBeenCalled()
  })
})

describe('refresh', () => {
  it('refreshes the project’s statuses', async () => {
    expect(await refreshStatusAction(PROJECT)).toEqual({
      status: 'ok',
      updated: 1,
    })
    expect(refreshStatuses).toHaveBeenCalledWith({
      userId: USER,
      projectId: PROJECT,
    })
  })

  it('a project that is not theirs is a not-found page', async () => {
    getProject.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(refreshStatusAction(PROJECT)).rejects.toThrow('not-found')
    expect(refreshStatuses).not.toHaveBeenCalled()
  })

  it('is rate limited, and passes on a Buffer failure', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await refreshStatusAction(PROJECT)).toEqual({ status: 'limited' })
    rateLimit.mockResolvedValue(true)
    refreshStatuses.mockResolvedValue({ ok: false, reason: 'rate_limited' })
    expect(await refreshStatusAction(PROJECT)).toEqual({
      status: 'rate_limited',
    })
  })
})

describe('the review step refuses a draft with a secret in it', () => {
  const key = ['sk', '-ant-', 'api03-', 'aB3xY9'.repeat(8)].join('')

  it('says so, names the kind and line but not the text, and asks Buffer nothing', async () => {
    getDraft.mockResolvedValue({
      id: DRAFT,
      projectId: PROJECT,
      body: `Hello\nkey: ${key}`,
    })
    const result = await startReviewAction(PROJECT, DRAFT)
    expect(result.status).toBe('secret')
    const message = result.status === 'secret' ? result.message : ''
    expect(message).toContain('Anthropic API key on line 2')
    expect(message).toContain('open the review again')
    expect(message).not.toContain(key)
    expect(channelsFor).not.toHaveBeenCalled()
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  it('a clean draft opens the review as before', async () => {
    getDraft.mockResolvedValue({
      id: DRAFT,
      projectId: PROJECT,
      body: 'A clean draft.',
    })
    expect((await startReviewAction(PROJECT, DRAFT)).status).toBe('ok')
  })
})
