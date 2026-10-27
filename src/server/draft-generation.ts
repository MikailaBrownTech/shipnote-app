import 'server-only'
import { randomBytes } from 'node:crypto'
import { costMicrousd, estimateMicrousd, modelConfig } from '@/lib/ai-models'
import { checkDraft, type DraftWarning } from '@/lib/draft-checker'
import {
  buildDraftInput,
  hasContent,
  inputChars,
  inputText,
} from '@/lib/draft-input'
import { validateDraftOutput, type OutputRejection } from '@/lib/draft-output'
import { buildUserMessage, SYSTEM_PROMPT } from '@/lib/draft-prompt'
import { postCommitsWithMessages, sinceDate } from '@/lib/github-commits'
import { findSecrets } from '@/lib/secret-scan'
import { AnthropicError, complete } from './anthropic'
import { aiEnabled, getAiEnv } from './env'
import {
  createInstallationToken,
  GithubError,
  listRecentCommits,
} from './github'
import { getProject } from './projects'
import {
  completeGeneration,
  generationsUsedToday,
  recordUnusableGeneration,
  releaseGeneration,
  reserveGeneration,
} from './supabase-admin'

// One draft: check the request, rebuild the commits from GitHub, build a small
// input, take a generation slot, call Claude once, check the answer, store it.
//
// Nothing here logs or returns a prompt, a draft, commit text, a note or a key.
// The daily limit and the monthly cap are enforced in Postgres (reserve_*).

export const DAILY_LIMIT = 10

export function aiIsEnabled(): boolean {
  return aiEnabled()
}

export type GenerateFailure =
  | 'disabled'
  | 'not_found'
  | 'no_content' // nothing to write from
  | 'github' // the linked repository could not be read
  | 'commit_not_found' // a chosen commit is not one of the repository's [post] commits
  | 'secret' // the material looks like it contains a secret
  | 'daily_limit'
  | 'monthly_cap'
  | 'provider' // Claude could not be reached: not counted
  | 'invalid_output' // Claude answered but the draft failed our checks: counted
  | 'failed'

export type GenerateResult =
  | {
      ok: true
      draft: { id: string; body: string; warnings: DraftWarning[] }
      // How many of today's drafts are left.
      left: number
    }
  | {
      ok: false
      reason: GenerateFailure
      // Which kinds of secret were found (kinds only, never the text).
      secretKinds?: string[]
      outputProblem?: OutputRejection
    }

// How many of today's drafts the user has left, or null if unknown.
export async function draftsLeftToday(userId: string): Promise<number | null> {
  const used = await generationsUsedToday(userId)
  return used === null ? null : Math.max(DAILY_LIMIT - used, 0)
}

export async function generateDraft(input: {
  userId: string
  projectId: string
  // Commit shas (7 to 40 hex characters) chosen on the page.
  shas: readonly string[]
  note: string
  nowMs?: number
}): Promise<GenerateResult> {
  const settings = getAiEnv()
  if (!settings) return { ok: false, reason: 'disabled' }
  const model = modelConfig(settings.model)
  if (!model) return { ok: false, reason: 'failed' }

  const found = await getProject(input.userId, input.projectId)
  if (!found.ok) {
    return {
      ok: false,
      reason: found.reason === 'not_found' ? 'not_found' : 'failed',
    }
  }
  const project = found.value

  // The commits are fetched from GitHub again, by sha, for this project's
  // repository. A sha from the form is only a request to look one up.
  const commits: { sha: string; message: string }[] = []
  if (input.shas.length > 0) {
    if (!project.repoFullName || project.installationId === null) {
      return { ok: false, reason: 'github' }
    }
    try {
      const token = await createInstallationToken(
        project.installationId,
        project.repoFullName,
      )
      const raw = await listRecentCommits(
        token,
        project.repoFullName,
        sinceDate(input.nowMs ?? Date.now()),
      )
      const eligible = postCommitsWithMessages(raw)
      for (const wanted of input.shas) {
        const matches = eligible.filter((commit) =>
          commit.sha.startsWith(wanted.toLowerCase()),
        )
        if (matches.length !== 1 || !matches[0]) {
          return { ok: false, reason: 'commit_not_found' }
        }
        commits.push(matches[0])
      }
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof GithubError && error.kind === 'not_found'
            ? 'commit_not_found'
            : 'github',
      }
    }
  }

  const data = buildDraftInput({
    stage: project.stage,
    name: project.name,
    summary: project.summary,
    notes: project.notes,
    commits,
    note: input.note,
  })
  if (!hasContent(data)) return { ok: false, reason: 'no_content' }

  // Commit messages are untrusted and could carry a secret: send nothing that
  // looks like one.
  const secrets = findSecrets(inputText(data))
  if (secrets.length > 0) {
    return {
      ok: false,
      reason: 'secret',
      secretKinds: [...new Set(secrets.map((s) => s.kind))],
    }
  }

  const nonce = randomBytes(8).toString('hex')
  const user = buildUserMessage(data, nonce)

  const slot = await reserveGeneration({
    userId: input.userId,
    estimatedMicrousd: estimateMicrousd(
      model,
      inputChars(data, SYSTEM_PROMPT.length),
    ),
    dailyLimit: DAILY_LIMIT,
    monthlyCapMicrousd: settings.monthlyCapMicrousd,
  })
  if (!slot.ok) return { ok: false, reason: slot.reason }

  let completion
  try {
    completion = await complete({
      apiKey: settings.apiKey,
      model,
      system: SYSTEM_PROMPT,
      user,
    })
  } catch (error) {
    // The provider or the network failed: the generation did not happen, so it
    // does not count.
    await releaseGeneration(slot.usageId, input.userId)
    if (error instanceof AnthropicError) {
      console.warn('drafts: provider error', error.kind, error.status ?? 'none')
      return { ok: false, reason: 'provider' }
    }
    return { ok: false, reason: 'failed' }
  }

  const cost = costMicrousd(model, completion.usage)
  const checked = validateDraftOutput(completion.text, {
    nonce,
    stopReason: completion.stopReason,
  })
  if (!checked.ok) {
    // The model answered and was paid for, so it counts.
    await recordUnusableGeneration(slot.usageId, input.userId, cost)
    return {
      ok: false,
      reason: 'invalid_output',
      outputProblem: checked.reason,
    }
  }

  const draftId = await completeGeneration({
    usageId: slot.usageId,
    userId: input.userId,
    projectId: project.id,
    body: checked.body,
    model: model.id,
    inputTokens:
      completion.usage.input_tokens +
      (completion.usage.cache_creation_input_tokens ?? 0) +
      (completion.usage.cache_read_input_tokens ?? 0),
    outputTokens: completion.usage.output_tokens,
    costMicrousd: cost,
    commitShas: commits.map((commit) => commit.sha),
  })
  if (draftId === null) {
    // Nothing was written. The call was made, so keep it on the books.
    await recordUnusableGeneration(slot.usageId, input.userId, cost)
    return { ok: false, reason: 'failed' }
  }

  const left = await draftsLeftToday(input.userId)
  return {
    ok: true,
    draft: {
      id: draftId,
      body: checked.body,
      warnings: checkDraft({
        body: checked.body,
        stage: project.stage,
        inputText: inputText(data),
      }),
    },
    left: left ?? 0,
  }
}
