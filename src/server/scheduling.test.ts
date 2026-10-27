import { createHash } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class BufferError extends Error {
  kind: string
  constructor(kind: string) {
    super(`Buffer request failed: ${kind}`)
    this.kind = kind
  }
}

const exchangeCode = vi.fn()
const fetchOrganizationId = vi.fn()
const listLinkedInChannels = vi.fn()
const createAtBuffer = vi.fn()
const deleteScheduledPost = vi.fn()
const getPostStatus = vi.fn()
const getSchedulingEnv = vi.fn()
const schedulingEnabled = vi.fn()
const getDraft = vi.fn()
const getConnectionStatus = vi.fn()
const getScheduledPost = vi.fn()
const listActiveSchedules = vi.fn()
const listProjectSchedules = vi.fn()
const createRow = vi.fn()
const deleteBufferConnection = vi.fn()
const finishScheduledPost = vi.fn()
const markPostScheduled = vi.fn()
const saveBufferConnection = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_SITE_URL: 'https://app.example' },
}))
vi.mock('./buffer', () => ({
  BufferError,
  createScheduledPost: createAtBuffer,
  deleteScheduledPost,
  exchangeCode,
  fetchOrganizationId,
  getPostStatus,
  listLinkedInChannels,
}))
vi.mock('./env', () => ({ getSchedulingEnv, schedulingEnabled }))
vi.mock('./buffer-state', () => ({ startState: vi.fn() }))
vi.mock('./drafts', () => ({ getDraft }))
vi.mock('./scheduled-posts', () => ({
  getConnectionStatus,
  getScheduledPost,
  listActiveSchedules,
  listProjectSchedules,
}))
vi.mock('./supabase-admin', () => ({
  createScheduledPost: createRow,
  deleteBufferConnection,
  finishScheduledPost,
  markPostScheduled,
  saveBufferConnection,
}))

const {
  bodyHash,
  callbackUrl,
  cancelSchedule,
  channelsFor,
  cleanupForDeletion,
  completeConnect,
  disconnectBuffer,
  refreshStatuses,
  scheduleDraft,
  SCHEDULE_DAILY_LIMIT,
} = await import('./scheduling')

const A = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const DRAFT = '99999999-2222-4333-8444-555555555555'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const NOW = Date.parse('2026-11-02T12:00:00Z')
const BODY = 'The exact text of the draft.\nSecond line.'
const key = randomBytes(32)

const request = (over: Record<string, unknown> = {}) => ({
  userId: A,
  draftId: DRAFT,
  reviewedHash: bodyHash(BODY),
  channelId: 'chan-1',
  local: '2026-11-10T09:30',
  timeZone: 'America/New_York',
  nowMs: NOW,
  ...over,
})

const post = (over: Record<string, unknown> = {}) => ({
  id: 'sp-1',
  projectId: PROJECT,
  draftId: DRAFT,
  body: BODY,
  channelLabel: 'My LinkedIn',
  scheduledFor: '2026-11-10T14:30:00.000Z',
  bufferPostId: 'bp-1',
  status: 'scheduled',
  failureCode: null,
  createdAt: '2026-11-02T12:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  schedulingEnabled.mockReturnValue(true)
  getSchedulingEnv.mockReturnValue({
    clientId: 'cid',
    clientSecret: 'csecret',
    keys: [{ version: 3, key }],
  })
  getDraft.mockResolvedValue({ id: DRAFT, body: BODY, projectId: PROJECT })
  listLinkedInChannels.mockResolvedValue([
    { id: 'chan-1', label: 'My LinkedIn' },
  ])
  createRow.mockResolvedValue({ ok: true, id: 'sp-1' })
  createAtBuffer.mockResolvedValue({ postId: 'bp-1' })
  markPostScheduled.mockResolvedValue(true)
  finishScheduledPost.mockResolvedValue(true)
  deleteBufferConnection.mockResolvedValue(true)
  getConnectionStatus.mockResolvedValue({
    state: 'connected',
    connectedAt: 'x',
  })
  listActiveSchedules.mockResolvedValue([])
  listProjectSchedules.mockResolvedValue([])
  saveBufferConnection.mockResolvedValue(true)
  deleteScheduledPost.mockResolvedValue('deleted')
})

describe('the review hash', () => {
  it('is the SHA-256 of the exact text, and changes with any edit', () => {
    expect(bodyHash(BODY)).toBe(createHash('sha256').update(BODY).digest('hex'))
    expect(bodyHash(`${BODY} `)).not.toBe(bodyHash(BODY))
    expect(bodyHash(BODY.replace('exact', 'Exact'))).not.toBe(bodyHash(BODY))
  })
})

describe('scheduleDraft: success', () => {
  it('writes the row first, then calls Buffer once with the exact text, then records the post', async () => {
    const result = await scheduleDraft(request())
    expect(result).toEqual({
      ok: true,
      id: 'sp-1',
      scheduledFor: '2026-11-10T14:30:00.000Z',
    })
    expect(createRow).toHaveBeenCalledExactlyOnceWith({
      userId: A,
      draftId: DRAFT,
      body: BODY,
      bodyHash: bodyHash(BODY),
      channelId: 'chan-1',
      channelLabel: 'My LinkedIn',
      scheduledFor: '2026-11-10T14:30:00.000Z',
      dailyLimit: SCHEDULE_DAILY_LIMIT,
    })
    expect(createAtBuffer).toHaveBeenCalledExactlyOnceWith({
      userId: A,
      channelId: 'chan-1',
      text: BODY,
      dueAt: new Date('2026-11-10T14:30:00.000Z'),
      nowMs: NOW,
    })
    expect(markPostScheduled).toHaveBeenCalledExactlyOnceWith({
      id: 'sp-1',
      userId: A,
      bufferPostId: 'bp-1',
    })
    expect(createRow.mock.invocationCallOrder[0]).toBeLessThan(
      createAtBuffer.mock.invocationCallOrder[0] ?? 0,
    )
    expect(finishScheduledPost).not.toHaveBeenCalled()
    expect(SCHEDULE_DAILY_LIMIT).toBe(5)
  })

  it('sends the saved text from the database, not anything from the request', async () => {
    await scheduleDraft(
      request({ body: 'text smuggled in the form', text: 'x' }),
    )
    expect(createAtBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ text: BODY }),
    )
  })

  it('reads the draft as the signed-in user', async () => {
    await scheduleDraft(request())
    expect(getDraft).toHaveBeenCalledWith(A, DRAFT)
    expect(listLinkedInChannels).toHaveBeenCalledWith(A, NOW)
  })
})

describe('scheduleDraft: refusals before anything is written', () => {
  it.each([
    ['a bad time', { local: 'nonsense' }, 'invalid_time'],
    ['a time too soon', { local: '2026-11-02T07:05' }, 'too_soon'],
    ['a time too far', { local: '2026-12-25T09:00' }, 'too_far'],
    ['a bad zone', { timeZone: 'Mars/Base' }, 'invalid_time'],
    [
      'a different text from the one reviewed',
      { reviewedHash: bodyHash('older text') },
      'text_changed',
    ],
    ['a channel that is not theirs', { channelId: 'someone-elses' }, 'channel'],
  ])('%s is refused', async (_label, over, reason) => {
    expect(await scheduleDraft(request(over))).toEqual({ ok: false, reason })
    expect(createRow).not.toHaveBeenCalled()
    expect(createAtBuffer).not.toHaveBeenCalled()
  })

  it('a draft that is not theirs is not found', async () => {
    getDraft.mockResolvedValue('not_found')
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(listLinkedInChannels).not.toHaveBeenCalled()
    expect(createAtBuffer).not.toHaveBeenCalled()
  })

  it('a draft edited after the review is refused, not scheduled with the new text', async () => {
    getDraft.mockResolvedValue({
      id: DRAFT,
      body: `${BODY} Edited later.`,
      projectId: PROJECT,
    })
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'text_changed',
    })
    expect(createAtBuffer).not.toHaveBeenCalled()
  })

  it.each(['needs_reconnect', 'rate_limited', 'unavailable'])(
    'a %s while reading channels stops before the row',
    async (reason) => {
      listLinkedInChannels.mockRejectedValue(new BufferError(reason))
      expect(await scheduleDraft(request())).toEqual({ ok: false, reason })
      expect(createRow).not.toHaveBeenCalled()
    },
  )

  it('a second schedule for the same draft is refused and Buffer is not called', async () => {
    createRow.mockResolvedValue({ ok: false, reason: 'already_scheduled' })
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'already_scheduled',
    })
    expect(createAtBuffer).not.toHaveBeenCalled()
  })

  it('the daily cap is enforced and Buffer is not called', async () => {
    createRow.mockResolvedValue({ ok: false, reason: 'daily_limit' })
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'daily_limit',
    })
    expect(createAtBuffer).not.toHaveBeenCalled()
  })

  it('a row that cannot be written means Buffer is not called', async () => {
    createRow.mockResolvedValue({ ok: false, reason: 'failed' })
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'failed',
    })
    expect(createAtBuffer).not.toHaveBeenCalled()
  })
})

describe('scheduleDraft: when Buffer fails', () => {
  it.each([
    ['needs_reconnect', 'needs_reconnect'],
    ['rate_limited', 'rate_limited'],
    ['limit_reached', 'plan_limit'],
    ['invalid', 'rejected'],
  ])(
    'a known refusal (%s) ends the row as failed and says so',
    async (kind, reason) => {
      createAtBuffer.mockRejectedValue(new BufferError(kind))
      expect(await scheduleDraft(request())).toEqual({ ok: false, reason })
      expect(finishScheduledPost).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: 'sp-1', userId: A, status: 'failed' }),
      )
      expect(markPostScheduled).not.toHaveBeenCalled()
    },
  )

  it.each(['unknown_result', 'unavailable'])(
    'a %s is marked failed and never retried: "check Buffer"',
    async (kind) => {
      createAtBuffer.mockRejectedValue(new BufferError(kind))
      expect(await scheduleDraft(request())).toEqual({
        ok: false,
        reason: 'unknown_result',
      })
      expect(createAtBuffer).toHaveBeenCalledOnce()
      expect(finishScheduledPost).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', failureCode: kind }),
      )
    },
  )

  it('an unexpected error is treated as an unknown result', async () => {
    createAtBuffer.mockRejectedValue(new Error('boom'))
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'unknown_result',
    })
    expect(createAtBuffer).toHaveBeenCalledOnce()
  })

  it('if Buffer accepted it but the row cannot be updated, it says check Buffer', async () => {
    markPostScheduled.mockResolvedValue(false)
    expect(await scheduleDraft(request())).toEqual({
      ok: false,
      reason: 'unknown_result',
    })
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failureCode: 'record_failed',
      }),
    )
    expect(createAtBuffer).toHaveBeenCalledOnce()
  })
})

describe('cancelSchedule', () => {
  it('deletes the post at Buffer, then marks it canceled', async () => {
    getScheduledPost.mockResolvedValue(post())
    expect(await cancelSchedule({ userId: A, id: 'sp-1', nowMs: NOW })).toBe(
      'canceled',
    )
    expect(deleteScheduledPost).toHaveBeenCalledExactlyOnceWith(A, 'bp-1', NOW)
    expect(finishScheduledPost).toHaveBeenCalledExactlyOnceWith({
      id: 'sp-1',
      userId: A,
      status: 'canceled',
      failureCode: null,
    })
    expect(deleteScheduledPost.mock.invocationCallOrder[0]).toBeLessThan(
      finishScheduledPost.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('does not mark it canceled if Buffer could not delete it', async () => {
    getScheduledPost.mockResolvedValue(post())
    for (const kind of ['unavailable', 'rate_limited', 'needs_reconnect']) {
      deleteScheduledPost.mockRejectedValue(new BufferError(kind))
      expect(await cancelSchedule({ userId: A, id: 'sp-1' })).toBe(kind)
    }
    expect(finishScheduledPost).not.toHaveBeenCalled()
  })

  it('a post already gone at Buffer counts as canceled', async () => {
    getScheduledPost.mockResolvedValue(post())
    deleteScheduledPost.mockRejectedValue(new BufferError('not_found'))
    expect(await cancelSchedule({ userId: A, id: 'sp-1' })).toBe('canceled')
  })

  it('a post Buffer already published is recorded as published, not canceled', async () => {
    getScheduledPost.mockResolvedValue(post())
    deleteScheduledPost.mockRejectedValue(new BufferError('invalid'))
    getPostStatus.mockResolvedValue('sent')
    expect(await cancelSchedule({ userId: A, id: 'sp-1' })).toBe('published')
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published' }),
    )
  })

  it('a refusal for another reason is a plain failure and the row is left alone', async () => {
    getScheduledPost.mockResolvedValue(post())
    deleteScheduledPost.mockRejectedValue(new BufferError('invalid'))
    getPostStatus.mockResolvedValue('scheduled')
    expect(await cancelSchedule({ userId: A, id: 'sp-1' })).toBe('failed')
    expect(finishScheduledPost).not.toHaveBeenCalled()
  })

  it('someone else’s or a missing schedule is not found, and Buffer is not called', async () => {
    getScheduledPost.mockResolvedValue('not_found')
    expect(await cancelSchedule({ userId: A, id: 'sp-1' })).toBe('not_found')
    expect(deleteScheduledPost).not.toHaveBeenCalled()
  })

  it.each([
    ['canceled', 'canceled'],
    ['published', 'published'],
    ['failed', 'not_active'],
    ['scheduling', 'in_progress'],
  ])(
    'a %s schedule gives %s without calling Buffer',
    async (status, expected) => {
      getScheduledPost.mockResolvedValue(post({ status }))
      expect(await cancelSchedule({ userId: A, id: 'sp-1' })).toBe(expected)
      expect(deleteScheduledPost).not.toHaveBeenCalled()
    },
  )
})

describe('refreshStatuses', () => {
  it('records published and failed posts and leaves scheduled ones', async () => {
    listProjectSchedules.mockResolvedValue([
      post({ id: '1', bufferPostId: 'b1' }),
      post({ id: '2', bufferPostId: 'b2' }),
      post({ id: '3', bufferPostId: 'b3' }),
      post({ id: '4', status: 'canceled' }),
    ])
    getPostStatus.mockImplementation((_u: string, id: string) =>
      Promise.resolve(
        id === 'b1' ? 'sent' : id === 'b2' ? 'error' : 'scheduled',
      ),
    )
    expect(await refreshStatuses({ userId: A, projectId: PROJECT })).toEqual({
      ok: true,
      updated: 2,
    })
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', status: 'published' }),
    )
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '2',
        status: 'failed',
        failureCode: 'buffer_error',
      }),
    )
    expect(getPostStatus).toHaveBeenCalledTimes(3)
  })

  it('stops at the first rate limit or reconnect', async () => {
    listProjectSchedules.mockResolvedValue([
      post({ id: '1' }),
      post({ id: '2' }),
    ])
    getPostStatus.mockRejectedValue(new BufferError('rate_limited'))
    expect(await refreshStatuses({ userId: A, projectId: PROJECT })).toEqual({
      ok: false,
      reason: 'rate_limited',
    })
    expect(getPostStatus).toHaveBeenCalledOnce()
  })

  it('a post removed in Buffer is recorded as canceled', async () => {
    listProjectSchedules.mockResolvedValue([post({ id: '1' })])
    getPostStatus.mockRejectedValue(new BufferError('not_found'))
    expect(await refreshStatuses({ userId: A, projectId: PROJECT })).toEqual({
      ok: true,
      updated: 1,
    })
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' }),
    )
  })
})

describe('connecting', () => {
  const run = () =>
    completeConnect({
      userId: A,
      code: 'code',
      verifier: 'v'.repeat(43),
      nowMs: NOW,
    })

  beforeEach(() => {
    exchangeCode.mockResolvedValue({
      accessToken: 'ACCESS-PLAIN',
      refreshToken: 'REFRESH-PLAIN',
      expiresAt: new Date(NOW + 3_600_000),
      scope: 'posts:write',
    })
    fetchOrganizationId.mockResolvedValue('org-1')
  })

  it('exchanges the code with the PKCE verifier and the exact redirect URI', async () => {
    await run()
    expect(exchangeCode).toHaveBeenCalledExactlyOnceWith({
      code: 'code',
      verifier: 'v'.repeat(43),
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'https://app.example/dashboard/buffer/callback',
      nowMs: NOW,
    })
    expect(callbackUrl()).toBe('https://app.example/dashboard/buffer/callback')
  })

  it('stores the tokens sealed for this user with the current key version, never plain', async () => {
    expect(await run()).toBe('connected')
    const saved = saveBufferConnection.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(saved).toMatchObject({
      userId: A,
      keyVersion: 3,
      organizationId: 'org-1',
      scopes: 'posts:write',
    })
    const text = JSON.stringify(saved)
    expect(text).not.toContain('ACCESS-PLAIN')
    expect(text).not.toContain('REFRESH-PLAIN')
    expect(text).not.toContain('csecret')
  })

  it.each([
    ['a refused code', new BufferError('needs_reconnect'), 'denied'],
    ['a rate limit', new BufferError('rate_limited'), 'rate_limited'],
    ['Buffer down', new BufferError('unavailable'), 'unavailable'],
    ['an odd answer', new BufferError('unknown_result'), 'unavailable'],
    ['an unexpected error', new Error('boom'), 'failed'],
  ])('%s stores nothing and gives %s', async (_label, error, result) => {
    exchangeCode.mockRejectedValue(error)
    expect(await run()).toBe(result)
    expect(saveBufferConnection).not.toHaveBeenCalled()
  })

  it('no organization means nothing is stored', async () => {
    fetchOrganizationId.mockResolvedValue(null)
    expect(await run()).toBe('no_organization')
    expect(saveBufferConnection).not.toHaveBeenCalled()
  })

  it('a failure to save is a failure', async () => {
    saveBufferConnection.mockResolvedValue(false)
    expect(await run()).toBe('failed')
  })

  it('is refused while scheduling is off', async () => {
    getSchedulingEnv.mockReturnValue(null)
    expect(await run()).toBe('failed')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('channelsFor maps failures to plain reasons', async () => {
    listLinkedInChannels.mockRejectedValue(new BufferError('needs_reconnect'))
    expect(await channelsFor(A)).toEqual({
      ok: false,
      reason: 'needs_reconnect',
    })
    listLinkedInChannels.mockRejectedValue(new Error('x'))
    expect(await channelsFor(A)).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('disconnecting', () => {
  it('without cancelling first, deletes only the stored tokens', async () => {
    listActiveSchedules.mockResolvedValue([post()])
    expect(await disconnectBuffer({ userId: A, cancelFirst: false })).toEqual({
      ok: true,
      canceled: 0,
      couldNotCancel: 0,
    })
    expect(deleteScheduledPost).not.toHaveBeenCalled()
    expect(deleteBufferConnection).toHaveBeenCalledExactlyOnceWith(A)
  })

  it('with cancelFirst, cancels at Buffer before deleting the tokens', async () => {
    listActiveSchedules.mockResolvedValue([
      post({ id: '1', bufferPostId: 'b1' }),
      post({ id: '2', bufferPostId: 'b2' }),
    ])
    const result = await disconnectBuffer({ userId: A, cancelFirst: true })
    expect(result).toEqual({ ok: true, canceled: 2, couldNotCancel: 0 })
    expect(deleteScheduledPost.mock.invocationCallOrder[1]).toBeLessThan(
      deleteBufferConnection.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('counts posts it could not cancel, and still deletes the tokens', async () => {
    listActiveSchedules.mockResolvedValue([
      post({ id: '1', bufferPostId: 'b1' }),
      post({ id: '2', bufferPostId: 'b2' }),
    ])
    deleteScheduledPost
      .mockResolvedValueOnce('deleted')
      .mockRejectedValueOnce(new BufferError('unavailable'))
    expect(await disconnectBuffer({ userId: A, cancelFirst: true })).toEqual({
      ok: true,
      canceled: 1,
      couldNotCancel: 1,
    })
    expect(deleteBufferConnection).toHaveBeenCalledOnce()
  })
})

describe('cleanup when an account is deleted', () => {
  it('cancels scheduled posts at Buffer, then deletes the tokens, then reports', async () => {
    listActiveSchedules.mockResolvedValue([
      post({ id: '1', bufferPostId: 'b1' }),
    ])
    expect(await cleanupForDeletion(A, NOW)).toEqual({
      canceled: 1,
      couldNotCancel: 0,
      hadConnection: true,
    })
    expect(deleteScheduledPost).toHaveBeenCalledWith(A, 'b1', NOW)
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', status: 'canceled' }),
    )
    expect(deleteBufferConnection).toHaveBeenCalledWith(A)
  })

  it('a failure to cancel never blocks: the tokens are deleted and the count is reported', async () => {
    listActiveSchedules.mockResolvedValue([
      post({ id: '1', bufferPostId: 'b1' }),
    ])
    deleteScheduledPost.mockRejectedValue(new BufferError('unavailable'))
    expect(await cleanupForDeletion(A)).toEqual({
      canceled: 0,
      couldNotCancel: 1,
      hadConnection: true,
    })
    expect(deleteBufferConnection).toHaveBeenCalledOnce()
    expect(finishScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' }),
    )
  })

  it('does not throw even if listing fails', async () => {
    listActiveSchedules.mockResolvedValue(null)
    await expect(cleanupForDeletion(A)).resolves.toMatchObject({
      hadConnection: true,
    })
    expect(deleteBufferConnection).toHaveBeenCalledOnce()
  })

  it('knows when there was no Buffer connection', async () => {
    getConnectionStatus.mockResolvedValue({ state: 'none', connectedAt: null })
    expect(await cleanupForDeletion(A)).toMatchObject({ hadConnection: false })
  })

  it('assumes there was one if it cannot tell', async () => {
    getConnectionStatus.mockResolvedValue(null)
    expect(await cleanupForDeletion(A)).toMatchObject({ hadConnection: true })
  })

  it('with the kill switch off, makes no Buffer call but still deletes the tokens', async () => {
    schedulingEnabled.mockReturnValue(false)
    listActiveSchedules.mockResolvedValue([post()])
    expect(await cleanupForDeletion(A)).toEqual({
      canceled: 0,
      couldNotCancel: 1,
      hadConnection: true,
    })
    expect(deleteScheduledPost).not.toHaveBeenCalled()
    expect(deleteBufferConnection).toHaveBeenCalledOnce()
  })
})

describe('logs', () => {
  it('nothing is logged, and results hold no text, token or body', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const results: unknown[] = []
    results.push(await scheduleDraft(request()))
    createAtBuffer.mockRejectedValue(new BufferError('unknown_result'))
    results.push(await scheduleDraft(request()))
    getScheduledPost.mockResolvedValue(post())
    results.push(await cancelSchedule({ userId: A, id: 'sp-1' }))
    results.push(await cleanupForDeletion(A))
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([])
    expect(JSON.stringify(results)).not.toContain('exact text')
  })
})
