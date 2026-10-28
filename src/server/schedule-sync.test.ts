import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class BufferError extends Error {
  kind: string
  constructor(kind: string) {
    super(`Buffer request failed: ${kind}`)
    this.kind = kind
  }
}

const schedulingIsEnabled = vi.fn()
const refreshOne = vi.fn()
const listDueSchedules = vi.fn()
const rateLimit = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./buffer', () => ({ BufferError }))
vi.mock('./rate-limit', () => ({ rateLimit }))
vi.mock('./scheduled-posts', () => ({ listDueSchedules }))
vi.mock('./scheduling', () => ({ refreshOne, schedulingIsEnabled }))

const { SYNC_BATCH, SYNC_BUDGET_MS, syncDueSchedules } =
  await import('./schedule-sync')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const NOW = Date.parse('2026-10-28T12:00:00Z')

const post = (id: string) => ({
  id,
  projectId: 'p1',
  draftId: null,
  body: 'PRIVATE POST TEXT do-not-log',
  channelLabel: null,
  scheduledFor: '2026-10-28T10:00:00Z',
  bufferPostId: `buffer-${id}`,
  status: 'scheduled',
  failureCode: null,
  createdAt: '2026-10-27T10:00:00Z',
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  schedulingIsEnabled.mockReturnValue(true)
  listDueSchedules.mockResolvedValue([post('1'), post('2')])
  rateLimit.mockResolvedValue(true)
  refreshOne.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('syncDueSchedules', () => {
  it('checks the user’s own due posts, one after another, and counts the changes', async () => {
    refreshOne.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await syncDueSchedules(USER, NOW)).toBe(1)
    expect(listDueSchedules).toHaveBeenCalledExactlyOnceWith(
      USER,
      '2026-10-28T12:00:00.000Z',
      SYNC_BATCH,
    )
    expect(refreshOne).toHaveBeenCalledTimes(2)
    expect(refreshOne).toHaveBeenNthCalledWith(1, {
      userId: USER,
      post: expect.objectContaining({ id: '1' }) as unknown,
      nowMs: NOW,
    })
    expect(refreshOne.mock.invocationCallOrder[0]).toBeLessThan(
      refreshOne.mock.invocationCallOrder[1] ?? 0,
    )
  })

  it('does nothing while scheduling is off', async () => {
    schedulingIsEnabled.mockReturnValue(false)
    expect(await syncDueSchedules(USER, NOW)).toBe(0)
    expect(listDueSchedules).not.toHaveBeenCalled()
    expect(refreshOne).not.toHaveBeenCalled()
  })

  it('does nothing, and uses no allowance, when nothing is due', async () => {
    listDueSchedules.mockResolvedValue([])
    expect(await syncDueSchedules(USER, NOW)).toBe(0)
    expect(rateLimit).not.toHaveBeenCalled()
    expect(refreshOne).not.toHaveBeenCalled()
  })

  it('does nothing if the due posts cannot be read', async () => {
    listDueSchedules.mockResolvedValue(null)
    expect(await syncDueSchedules(USER, NOW)).toBe(0)
    expect(refreshOne).not.toHaveBeenCalled()
  })

  it('is rate limited per user, and asks Buffer nothing when over', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await syncDueSchedules(USER, NOW)).toBe(0)
    expect(rateLimit).toHaveBeenCalledExactlyOnceWith('scheduleSync', USER)
    expect(refreshOne).not.toHaveBeenCalled()
  })

  it('stops at the first Buffer problem, never throws, and logs only the kind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    refreshOne.mockRejectedValue(new BufferError('needs_reconnect'))
    expect(await syncDueSchedules(USER, NOW)).toBe(0)
    expect(refreshOne).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'schedule sync: stopped',
      'needs_reconnect',
    )
  })

  it('an unexpected error is also contained, and its text is not logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    refreshOne.mockRejectedValue(new Error('token abc PRIVATE POST TEXT'))
    expect(await syncDueSchedules(USER, NOW)).toBe(0)
    expect(JSON.stringify(warn.mock.calls)).toBe(
      JSON.stringify([['schedule sync: stopped', 'unexpected']]),
    )
  })

  it('keeps what it changed before a problem', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    refreshOne
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new BufferError('rate_limited'))
    expect(await syncDueSchedules(USER, NOW)).toBe(1)
  })

  it('stops once its time budget is spent, leaving the rest for the next visit', async () => {
    listDueSchedules.mockResolvedValue([post('1'), post('2'), post('3')])
    refreshOne.mockImplementation(() => {
      vi.setSystemTime(Date.now() + SYNC_BUDGET_MS + 1)
      return Promise.resolve(true)
    })
    expect(await syncDueSchedules(USER, NOW)).toBe(1)
    expect(refreshOne).toHaveBeenCalledOnce()
  })

  it('logs nothing on success', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    await syncDueSchedules(USER, NOW)
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([])
  })
})
