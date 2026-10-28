import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateAutoDraft = vi.fn()
const claimAutoDraftJob = vi.fn()
const finishAutoDraftJob = vi.fn()
const releaseAutoDraftJob = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./draft-generation', () => ({ generateAutoDraft }))
vi.mock('./supabase-admin', () => ({
  claimAutoDraftJob,
  finishAutoDraftJob,
  releaseAutoDraftJob,
}))

const { runAutoDraftJob } = await import('./auto-draft-worker')

const A = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const B = '99999999-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const PROJECT_A = '11111111-2222-4333-8444-555555555555'
const SHA = 'a'.repeat(40)
const DELIVERY = '33333333-aaaa-4bbb-8ccc-444444444444'
const job = (over: Record<string, string> = {}) => ({
  userId: A,
  projectId: PROJECT_A,
  commitSha: SHA,
  deliveryId: DELIVERY,
  ...over,
})

// A tiny stand-in for the database: one queued job, claimed atomically, only by
// the user and project it belongs to.
let status: 'queued' | 'running' | 'done' | 'skipped' | 'failed'
beforeEach(() => {
  vi.clearAllMocks()
  status = 'queued'
  claimAutoDraftJob.mockImplementation(
    (input: { userId: string; projectId: string; commitSha: string }) => {
      const mine =
        input.userId === A &&
        input.projectId === PROJECT_A &&
        input.commitSha === SHA
      if (mine && status === 'queued') {
        status = 'running'
        return Promise.resolve({ ok: true, id: 'job-1' })
      }
      return Promise.resolve({ ok: true, id: null })
    },
  )
  releaseAutoDraftJob.mockImplementation(() => {
    if (status === 'running') status = 'queued'
    return Promise.resolve(true)
  })
  finishAutoDraftJob.mockImplementation(
    (input: { status: 'done' | 'skipped' | 'failed' }) => {
      if (status === 'running') status = input.status
      return Promise.resolve(true)
    },
  )
  generateAutoDraft.mockResolvedValue({ ok: true, draftId: 'draft-1' })
})

describe('a successful job', () => {
  it('claims once, runs the pipeline for that user, project and sha, and records the draft', async () => {
    expect(await runAutoDraftJob(job(), 0)).toBe('done')
    expect(generateAutoDraft).toHaveBeenCalledExactlyOnceWith({
      userId: A,
      projectId: PROJECT_A,
      commitSha: SHA,
    })
    expect(finishAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-1',
      userId: A,
      status: 'done',
      reason: null,
      draftId: 'draft-1',
    })
    expect(status).toBe('done')
  })
})

describe('duplicates and other users', () => {
  it('a duplicate delivery runs once: the second does nothing and is a success', async () => {
    const outcomes = await Promise.all([
      runAutoDraftJob(job(), 0),
      runAutoDraftJob(job(), 0),
      runAutoDraftJob(job(), 1),
    ])
    expect(outcomes.filter((o) => o === 'done')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(2)
    expect(generateAutoDraft).toHaveBeenCalledOnce()
  })

  it('a delivery after the job finished does nothing', async () => {
    await runAutoDraftJob(job(), 0)
    expect(await runAutoDraftJob(job(), 1)).toBe('duplicate')
    expect(generateAutoDraft).toHaveBeenCalledOnce()
  })

  it('user B naming user A’s project can claim nothing, so no installation or token is touched', async () => {
    expect(await runAutoDraftJob(job({ userId: B }), 0)).toBe('duplicate')
    expect(generateAutoDraft).not.toHaveBeenCalled()
    expect(finishAutoDraftJob).not.toHaveBeenCalled()
    expect(status).toBe('queued')
  })

  it('a message for a commit that has no job claims nothing', async () => {
    expect(await runAutoDraftJob(job({ commitSha: 'b'.repeat(40) }), 0)).toBe(
      'duplicate',
    )
    expect(generateAutoDraft).not.toHaveBeenCalled()
  })

  it('the claim carries the user, project and commit from the message', async () => {
    await runAutoDraftJob(job(), 0)
    expect(claimAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      userId: A,
      projectId: PROJECT_A,
      commitSha: SHA,
    })
  })

  it('a database failure while claiming is a retry, with nothing run', async () => {
    claimAutoDraftJob.mockResolvedValue({ ok: false })
    expect(await runAutoDraftJob(job(), 0)).toBe('retry')
    expect(generateAutoDraft).not.toHaveBeenCalled()
    expect(releaseAutoDraftJob).not.toHaveBeenCalled()
  })
})

describe('limits and eligibility end the job without a retry', () => {
  it.each([
    'daily_limit',
    'monthly_cap',
    'no_tag',
    'merge_commit',
    'project_gone',
    'disabled',
  ])('%s is skipped and the queue is told success', async (reason) => {
    generateAutoDraft.mockResolvedValue({ ok: false, reason })
    expect(await runAutoDraftJob(job(), 0)).toBe('skipped')
    expect(finishAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-1',
      userId: A,
      status: 'skipped',
      reason,
      draftId: null,
    })
    expect(releaseAutoDraftJob).not.toHaveBeenCalled()
    expect(status).toBe('skipped')
  })

  it('a skipped job is never worked again', async () => {
    generateAutoDraft.mockResolvedValue({ ok: false, reason: 'daily_limit' })
    await runAutoDraftJob(job(), 0)
    expect(await runAutoDraftJob(job(), 1)).toBe('duplicate')
    expect(generateAutoDraft).toHaveBeenCalledOnce()
  })
})

describe('permanent failures are not retried', () => {
  it.each([
    'commit_not_found',
    'github_gone',
    'secret',
    'invalid_output',
    'no_content',
  ])('%s fails the job for good', async (reason) => {
    generateAutoDraft.mockResolvedValue({ ok: false, reason })
    expect(await runAutoDraftJob(job(), 0)).toBe('failed')
    expect(finishAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-1',
      userId: A,
      status: 'failed',
      reason,
      draftId: null,
    })
    expect(releaseAutoDraftJob).not.toHaveBeenCalled()
    expect(status).toBe('failed')
  })
})

describe('temporary problems are retried', () => {
  it.each(['provider', 'github_retry', 'failed'])(
    '%s releases the job so the retry can claim it',
    async (reason) => {
      generateAutoDraft.mockResolvedValue({ ok: false, reason })
      expect(await runAutoDraftJob(job(), 0)).toBe('retry')
      expect(releaseAutoDraftJob).toHaveBeenCalledExactlyOnceWith('job-1', A)
      expect(finishAutoDraftJob).not.toHaveBeenCalled()
      expect(status).toBe('queued')
    },
  )

  it('the retry then claims it again and can finish', async () => {
    generateAutoDraft.mockResolvedValueOnce({ ok: false, reason: 'provider' })
    expect(await runAutoDraftJob(job(), 0)).toBe('retry')
    expect(await runAutoDraftJob(job(), 1)).toBe('done')
    expect(generateAutoDraft).toHaveBeenCalledTimes(2)
  })

  it('on the last try the job is failed, not left waiting', async () => {
    generateAutoDraft.mockResolvedValue({ ok: false, reason: 'provider' })
    expect(await runAutoDraftJob(job(), 3)).toBe('failed')
    expect(finishAutoDraftJob).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-1',
      userId: A,
      status: 'failed',
      reason: 'provider',
      draftId: null,
    })
    expect(releaseAutoDraftJob).not.toHaveBeenCalled()
  })

  it('an unexpected error is a retry, then a failure on the last try, and is never logged', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    generateAutoDraft.mockRejectedValue(new Error('PRIVATE COMMIT TEXT'))
    expect(await runAutoDraftJob(job(), 0)).toBe('retry')
    expect(await runAutoDraftJob(job(), 3)).toBe('failed')
    expect(finishAutoDraftJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', reason: 'failed' }),
    )
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(
      'PRIVATE',
    )
  })
})

describe('what the job records', () => {
  it('only fixed codes: never text from the commit or the draft', async () => {
    generateAutoDraft.mockResolvedValue({ ok: false, reason: 'secret' })
    await runAutoDraftJob(job(), 0)
    const recorded = JSON.stringify(finishAutoDraftJob.mock.calls)
    expect(recorded).toMatch(/"reason":"secret"/)
    expect(recorded).not.toMatch(/[A-Z]{3,}/)
  })
})
