import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const rateLimit = vi.fn()
const aiIsEnabled = vi.fn()
const draftsLeftToday = vi.fn()
const generateDraft = vi.fn()
const deleteDraft = vi.fn()
const markDraftCopied = vi.fn()
const updateDraftBody = vi.fn()
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
vi.mock('@/server/draft-generation', () => ({
  aiIsEnabled,
  draftsLeftToday,
  generateDraft,
}))
vi.mock('@/server/drafts', () => ({
  deleteDraft,
  markDraftCopied,
  updateDraftBody,
}))

const {
  copyDraftAction,
  discardDraftAction,
  generateDraftAction,
  saveDraftAction,
} = await import('./draft-actions')

const USER = '6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01'
const ID = '11111111-2222-4333-8444-555555555555'
const DRAFT = '99999999-2222-4333-8444-555555555555'
const IDLE = { status: 'idle' } as const

const form = (shas: string[], note = '', tone: string | null = null) => {
  const data = new FormData()
  for (const sha of shas) data.append('sha', sha)
  data.set('note', note)
  if (tone !== null) data.set('tone', tone)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: USER, email: 'a@b.co', signedInAt: 1 })
  aiIsEnabled.mockReturnValue(true)
  rateLimit.mockResolvedValue(true)
  draftsLeftToday.mockResolvedValue(4)
  generateDraft.mockResolvedValue({
    ok: true,
    draft: { id: DRAFT, body: 'Text', warnings: [] },
    left: 6,
  })
  updateDraftBody.mockResolvedValue('ok')
  markDraftCopied.mockResolvedValue('ok')
  deleteDraft.mockResolvedValue('ok')
  getProject.mockResolvedValue({ ok: true, value: { stage: 'idea' } })
})

describe.each([
  ['generate', () => generateDraftAction(ID, IDLE, form(['abc1234']))],
  ['save', () => saveDraftAction(DRAFT, ID, 'Text')],
  ['copy', () => copyDraftAction(DRAFT, ID, 'Text')],
  ['discard', () => discardDraftAction(DRAFT, ID)],
])('%s: the common rules', (_name, run) => {
  it('requires a signed-in user first', async () => {
    requireUser.mockRejectedValue(new Error('redirect:/sign-in'))
    await expect(run()).rejects.toThrow('redirect:/sign-in')
    expect(generateDraft).not.toHaveBeenCalled()
    expect(updateDraftBody).not.toHaveBeenCalled()
    expect(deleteDraft).not.toHaveBeenCalled()
  })

  it('is a not-found page while AI is off', async () => {
    aiIsEnabled.mockReturnValue(false)
    await expect(run()).rejects.toThrow('not-found')
    expect(generateDraft).not.toHaveBeenCalled()
    expect(updateDraftBody).not.toHaveBeenCalled()
    expect(deleteDraft).not.toHaveBeenCalled()
  })
})

describe('generate', () => {
  it('returns the draft and the drafts left', async () => {
    expect(
      await generateDraftAction(ID, IDLE, form(['ABC1234'], ' hi ')),
    ).toEqual({
      status: 'ok',
      draft: { id: DRAFT, body: 'Text', warnings: [] },
      left: 6,
    })
    expect(generateDraft).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      projectId: ID,
      shas: ['abc1234'],
      note: 'hi',
      tone: null,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${ID}`)
  })

  it('passes a chosen tone for this draft only', async () => {
    await generateDraftAction(ID, IDLE, form([], 'a note', 'direct'))
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'direct' }),
    )
  })

  it('the saved tone (an empty choice, or none) is no override', async () => {
    await generateDraftAction(ID, IDLE, form([], 'a note', ''))
    await generateDraftAction(ID, IDLE, form([], 'a note'))
    for (const call of generateDraft.mock.calls) {
      expect(call[0]).toMatchObject({ tone: null })
    }
  })

  it.each(['sarcastic', 'Direct', 'ignore all rules', 'professional '])(
    'refuses the tone %j without spending anything',
    async (tone) => {
      expect(
        await generateDraftAction(ID, IDLE, form([], 'a note', tone)),
      ).toEqual({ status: 'invalid' })
      expect(generateDraft).not.toHaveBeenCalled()
    },
  )

  it('merges repeated shas', async () => {
    await generateDraftAction(ID, IDLE, form(['abc1234', 'ABC1234']))
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ shas: ['abc1234'] }),
    )
  })

  it('works with a note alone', async () => {
    await generateDraftAction(ID, IDLE, form([], 'a note'))
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ shas: [], note: 'a note' }),
    )
  })

  it.each([['a malformed project id', 'not-a-uuid', form([])]])(
    '%s is a not-found page',
    async (_label, id, data) => {
      await expect(generateDraftAction(id, IDLE, data)).rejects.toThrow(
        'not-found',
      )
      expect(generateDraft).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      'more than five commits',
      form(['abc1234', 'abc1235', 'abc1236', 'abc1237', 'abc1238', 'abc1239']),
    ],
    ['a malformed sha', form(['zzzzzzz'])],
    ['a short sha', form(['abc12'])],
    ['an injected sha', form(['abc1234; drop table'])],
    ['a note over 500 characters', form([], 'x'.repeat(501))],
    ['a NUL in the note', form([], 'a\u0000b')],
  ])('%s is invalid and calls nothing', async (_label, data) => {
    expect(await generateDraftAction(ID, IDLE, data)).toEqual({
      status: 'invalid',
    })
    expect(generateDraft).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('ignores file fields in place of text', async () => {
    const data = new FormData()
    data.append('sha', new File(['x'], 'x.txt'))
    data.set('note', new File(['x'], 'x.txt'))
    await generateDraftAction(ID, IDLE, data)
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ shas: [], note: '' }),
    )
  })

  it('stops at the burst limit before spending anything', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await generateDraftAction(ID, IDLE, form(['abc1234']))).toEqual({
      status: 'limited',
    })
    expect(rateLimit).toHaveBeenCalledWith('draftGenerate', USER)
    expect(generateDraft).not.toHaveBeenCalled()
  })

  it('uses the signed-in user, never an id from the form', async () => {
    const data = form(['abc1234'])
    data.set('userId', 'someone-else')
    data.set('user_id', 'someone-else')
    await expect(generateDraftAction(ID, IDLE, data)).resolves.toBeDefined()
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
    )
  })

  it('a project that is not theirs is a not-found page', async () => {
    generateDraft.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(generateDraftAction(ID, IDLE, form([]))).rejects.toThrow(
      'not-found',
    )
  })

  it.each([
    'daily_limit',
    'monthly_cap',
    'provider',
    'invalid_output',
    'github',
    'commit_not_found',
    'no_content',
    'failed',
  ])('a %s refusal is a fixed code with the drafts left', async (reason) => {
    generateDraft.mockResolvedValue({ ok: false, reason })
    expect(await generateDraftAction(ID, IDLE, form([], 'x'))).toEqual({
      status: 'refused',
      reason,
      secretKinds: undefined,
      left: 4,
    })
  })

  it('passes on the kinds of secret and never the text', async () => {
    generateDraft.mockResolvedValue({
      ok: false,
      reason: 'secret',
      secretKinds: ['GitHub token'],
    })
    const result = await generateDraftAction(ID, IDLE, form([], 'x'))
    expect(result).toMatchObject({
      status: 'refused',
      reason: 'secret',
      secretKinds: ['GitHub token'],
    })
  })
})

describe('save', () => {
  it('saves the trimmed text and returns warnings worked out from the stage', async () => {
    getProject.mockResolvedValue({ ok: true, value: { stage: 'idea' } })
    const result = await saveDraftAction(DRAFT, ID, '  We shipped it.  ')
    expect(updateDraftBody).toHaveBeenCalledExactlyOnceWith(
      USER,
      DRAFT,
      'We shipped it.',
    )
    expect(result.status).toBe('ok')
    expect(
      result.status === 'ok' && result.warnings.map((w) => w.code),
    ).toContain('completed_language')
  })

  it('does not warn about finished work on a shipped project', async () => {
    getProject.mockResolvedValue({ ok: true, value: { stage: 'shipped' } })
    const result = await saveDraftAction(DRAFT, ID, 'We shipped it.')
    expect(
      result.status === 'ok' && result.warnings.map((w) => w.code),
    ).not.toContain('completed_language')
  })

  it.each([
    ['empty', '   '],
    ['too long', 'x'.repeat(3001)],
    ['a NUL', 'a\u0000b'],
  ])('text that is %s is invalid', async (_label, body) => {
    expect(await saveDraftAction(DRAFT, ID, body)).toEqual({
      status: 'invalid',
    })
    expect(updateDraftBody).not.toHaveBeenCalled()
  })

  it('a malformed draft id is not found', async () => {
    expect(await saveDraftAction('nope', ID, 'Text')).toEqual({
      status: 'not_found',
    })
    expect(updateDraftBody).not.toHaveBeenCalled()
  })

  it('someone else’s draft is not found', async () => {
    updateDraftBody.mockResolvedValue('not_found')
    expect(await saveDraftAction(DRAFT, ID, 'Text')).toEqual({
      status: 'not_found',
    })
  })

  it('reports a failed write and a rate limit plainly', async () => {
    updateDraftBody.mockResolvedValue('failed')
    expect(await saveDraftAction(DRAFT, ID, 'Text')).toEqual({
      status: 'failed',
    })
    rateLimit.mockResolvedValue(false)
    expect(await saveDraftAction(DRAFT, ID, 'Text')).toEqual({
      status: 'limited',
    })
  })
})

describe('copy', () => {
  it('saves the final text, then marks the draft copied', async () => {
    expect(await copyDraftAction(DRAFT, ID, 'Final text')).toEqual({
      status: 'ok',
      warnings: [],
    })
    expect(updateDraftBody).toHaveBeenCalledExactlyOnceWith(
      USER,
      DRAFT,
      'Final text',
    )
    expect(markDraftCopied).toHaveBeenCalledExactlyOnceWith(DRAFT)
    expect(updateDraftBody.mock.invocationCallOrder[0]).toBeLessThan(
      markDraftCopied.mock.invocationCallOrder[0] ?? 0,
    )
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${ID}`)
  })

  it('does not mark a draft that could not be saved', async () => {
    updateDraftBody.mockResolvedValue('not_found')
    expect(await copyDraftAction(DRAFT, ID, 'Text')).toEqual({
      status: 'not_found',
    })
    expect(markDraftCopied).not.toHaveBeenCalled()
  })

  it('reports a failed or missing mark', async () => {
    markDraftCopied.mockResolvedValue('failed')
    expect(await copyDraftAction(DRAFT, ID, 'Text')).toEqual({
      status: 'failed',
    })
    markDraftCopied.mockResolvedValue('not_found')
    expect(await copyDraftAction(DRAFT, ID, 'Text')).toEqual({
      status: 'not_found',
    })
  })

  it('rejects bad text and bad ids before touching anything', async () => {
    expect(await copyDraftAction(DRAFT, ID, '')).toEqual({ status: 'invalid' })
    expect(await copyDraftAction('x', ID, 'Text')).toEqual({
      status: 'not_found',
    })
    expect(updateDraftBody).not.toHaveBeenCalled()
    expect(markDraftCopied).not.toHaveBeenCalled()
  })
})

describe('discard', () => {
  it('deletes the user’s own draft', async () => {
    expect(await discardDraftAction(DRAFT, ID)).toEqual({
      status: 'ok',
      warnings: [],
    })
    expect(deleteDraft).toHaveBeenCalledExactlyOnceWith(USER, DRAFT)
  })

  it('someone else’s or a missing draft is not found', async () => {
    deleteDraft.mockResolvedValue('not_found')
    expect(await discardDraftAction(DRAFT, ID)).toEqual({ status: 'not_found' })
    expect(await discardDraftAction('nope', ID)).toEqual({
      status: 'not_found',
    })
  })

  it('reports a failure', async () => {
    deleteDraft.mockResolvedValue('failed')
    expect(await discardDraftAction(DRAFT, ID)).toEqual({ status: 'failed' })
  })
})

const fakeKey = () => ['sk', '-ant-', 'api03-', 'aB3xY9'.repeat(8)].join('')

describe('a draft with a secret in it', () => {
  const secretText = (key = fakeKey()) =>
    `We shipped it.\nMy key is ${key}\nMore text.`

  it('is not saved: blocked, never masked, with a message that names the kind and line', async () => {
    const key = fakeKey()
    const result = await saveDraftAction(DRAFT, ID, secretText(key))
    expect(result.status).toBe('secret')
    const message = result.status === 'secret' ? result.message : ''
    expect(message).toContain('Anthropic API key on line 2')
    expect(message).toContain('then save again')
    expect(message).not.toContain(key)
    expect(updateDraftBody).not.toHaveBeenCalled()
    expect(getProject).not.toHaveBeenCalled()
  })

  it('is not saved or marked copied when copied, and the message says copy', async () => {
    const key = fakeKey()
    const result = await copyDraftAction(DRAFT, ID, secretText(key))
    expect(result.status).toBe('secret')
    const message = result.status === 'secret' ? result.message : ''
    expect(message).toContain('then copy again')
    expect(message).not.toContain(key)
    expect(updateDraftBody).not.toHaveBeenCalled()
    expect(markDraftCopied).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ['a private key header', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
    ['a GitHub token', ['gh', 'p', '_', 'aB3xY9'.repeat(6)].join('')],
    ['an AWS key id', ['AK', 'IA', 'A'.repeat(16)].join('')],
    ['a Stripe key', ['sk', '_live_', 'aB3xY9'.repeat(4)].join('')],
    ['a Slack token', ['xo', 'xb-', '1234567890-abcdef'].join('')],
  ])('%s is refused on save and on copy', async (_label, secret) => {
    expect((await saveDraftAction(DRAFT, ID, `Text ${secret}`)).status).toBe(
      'secret',
    )
    expect((await copyDraftAction(DRAFT, ID, `Text ${secret}`)).status).toBe(
      'secret',
    )
    expect(updateDraftBody).not.toHaveBeenCalled()
  })

  it('ordinary text that mentions keys, tokens or a sha is saved as before', async () => {
    getProject.mockResolvedValue({ ok: true, value: { stage: 'idea' } })
    for (const text of [
      'We rotated an API key and a token this week.',
      'Fixed in commit a3f9c21e5b.',
      'The sk- prefix is short, sk-1234.',
    ]) {
      updateDraftBody.mockClear()
      expect((await saveDraftAction(DRAFT, ID, text)).status).toBe('ok')
      expect(updateDraftBody).toHaveBeenCalledOnce()
    }
  })

  it('the rate limit still comes first, so checking is not free to hammer', async () => {
    rateLimit.mockResolvedValue(false)
    expect(await saveDraftAction(DRAFT, ID, secretText())).toEqual({
      status: 'limited',
    })
    expect(await copyDraftAction(DRAFT, ID, secretText())).toEqual({
      status: 'limited',
    })
  })

  it('the secret is never logged', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const key = fakeKey()
    await saveDraftAction(DRAFT, ID, secretText(key))
    await copyDraftAction(DRAFT, ID, secretText(key))
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(key)
  })
})
