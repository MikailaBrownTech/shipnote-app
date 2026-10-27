import Link from 'next/link'
import { isRepoFullName } from '@/lib/github-repo'
import type { Prefill } from '@/lib/repo-prefill'
import { PROJECT_LIMITS } from '@/lib/project-schema'
import { describeSecrets, findSecrets } from '@/lib/secret-scan'
import { githubIsEnabled } from '@/server/github-app'
import {
  listStartRepos,
  prefillFromRepo,
  type RepoCheckFailure,
  type StartChoices,
} from '@/server/github-import'
import { listInstallations } from '@/server/github-projects'
import { rateLimit } from '@/server/rate-limit'
import { Icon } from '../../icons'
import projectStyles from '../projects.module.css'

// "Start from a GitHub repo" on the new-project page. Everything here only
// READS: choosing a repository fills in the form, and nothing is saved until
// the person presses Create. The repository comes from the installation's list
// on GitHub and is checked again on the server; the URL value is never trusted.

type Params = Record<string, string | string[] | undefined>

export type StartState =
  // The feature is off, or the person has no GitHub connection: show nothing.
  | { kind: 'hidden' }
  // Connected, nothing chosen yet: offer the button.
  | { kind: 'closed' }
  // The list of repositories to choose from.
  | { kind: 'picker'; choices: StartChoices | { status: 'limited' } }
  // A repository was chosen and its values are ready.
  | {
      kind: 'prefilled'
      prefill: Prefill
      link: { installationId: number; repoFullName: string }
      // Kind and line only, never the text.
      secretNote: string | null
    }
  // A repository was chosen but could not be used.
  | { kind: 'failed'; reason: RepoCheckFailure | 'limited' }

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined

// The picker sends "<installation id>|<owner/repo>".
function parseRepoParam(
  value: string | undefined,
): { installationId: number; repoFullName: string } | null {
  if (!value) return null
  const at = value.indexOf('|')
  if (at < 1) return null
  const id = value.slice(0, at)
  const repoFullName = value.slice(at + 1)
  if (!/^\d{1,15}$/.test(id) || !isRepoFullName(repoFullName)) return null
  return { installationId: Number(id), repoFullName }
}

export async function loadStart(
  userId: string,
  params: Params,
): Promise<StartState> {
  if (!githubIsEnabled()) return { kind: 'hidden' }
  const installations = await listInstallations(userId)
  if (installations === null || installations.length === 0) {
    return { kind: 'hidden' }
  }

  const repo = one(params.repo)
  if (repo !== undefined) {
    const chosen = parseRepoParam(repo)
    if (!chosen) return { kind: 'failed', reason: 'not_in_list' }
    if (!(await rateLimit('githubPrefill', userId))) {
      return { kind: 'failed', reason: 'limited' }
    }
    const result = await prefillFromRepo({ userId, ...chosen })
    if (result.status !== 'ok') return { kind: 'failed', reason: result.status }
    const found = findSecrets(result.prefill.notes)
    return {
      kind: 'prefilled',
      prefill: result.prefill,
      link: result.link,
      secretNote:
        found.length > 0
          ? describeSecrets(found, 'the notes').replace(
              ' Remove it, then save again.',
              ' You will need to remove it before you can save.',
            )
          : null,
    }
  }

  if (one(params.from) === 'github') {
    if (!(await rateLimit('githubRepos', userId))) {
      return { kind: 'picker', choices: { status: 'limited' } }
    }
    return { kind: 'picker', choices: await listStartRepos(userId) }
  }
  return { kind: 'closed' }
}

const NEW = '/dashboard/projects/new'

const failureText: Record<RepoCheckFailure | 'limited', string> = {
  not_in_list:
    'That repository is not available through your GitHub connection. Choose another.',
  already_linked: 'That repository is already linked to one of your projects.',
  no_installation:
    'Shipnote no longer has access to GitHub. Reconnect GitHub from the dashboard.',
  rate_limited:
    'GitHub is limiting requests right now. Try again in a few minutes.',
  unavailable: 'GitHub is not responding. Try again in a moment.',
  failed: 'We could not load that repository. Try again.',
  limited: 'Too many attempts. Try again in a few minutes.',
}

export function StartFromRepo({ state }: { state: StartState }) {
  if (state.kind === 'hidden') return null

  return (
    <section
      className={`card ${projectStyles.startCard}`}
      aria-labelledby="start-title"
    >
      <h2 id="start-title" className={projectStyles.githubTitle}>
        <Icon name="gear" size={20} />
        Start from a GitHub repo
      </h2>

      {state.kind === 'closed' ? (
        <>
          <p className={projectStyles.help}>
            Fill in the form from one of your repositories: its name,
            description and README. You review and edit it first, and nothing is
            saved until you press Create.
          </p>
          <div className={projectStyles.githubActions}>
            <Link href={`${NEW}?from=github`} className="button">
              Choose a repository
            </Link>
          </div>
        </>
      ) : null}

      {state.kind === 'picker' ? <Picker choices={state.choices} /> : null}

      {state.kind === 'failed' ? (
        <>
          <p role="alert" className={`on-pink ${projectStyles.notice}`}>
            {failureText[state.reason]}
          </p>
          <div className={projectStyles.githubActions}>
            <Link href={`${NEW}?from=github`} className="button button-soft">
              Choose another repository
            </Link>
            <Link href={NEW} className="button button-soft">
              Start without a repository
            </Link>
          </div>
        </>
      ) : null}

      {state.kind === 'prefilled' ? (
        <>
          <p role="status" className={`on-azure ${projectStyles.notice}`}>
            Filled in from <strong>{state.link.repoFullName}</strong>. Review
            and edit it, then press Create project. Nothing is saved until you
            do.
          </p>
          {state.prefill.truncated ? (
            <p role="status" className={`on-amber ${projectStyles.notice}`}>
              The README is longer than the{' '}
              {PROJECT_LIMITS.notes.toLocaleString('en')} character limit for
              notes, so only the first{' '}
              {PROJECT_LIMITS.notes.toLocaleString('en')} characters were
              copied. Check the notes before you save.
            </p>
          ) : null}
          {!state.prefill.hasReadme ? (
            <p role="status" className={`on-amber ${projectStyles.notice}`}>
              This repository has no README, so the notes are empty.
            </p>
          ) : null}
          {state.secretNote ? (
            <p role="alert" className={`on-pink ${projectStyles.notice}`}>
              {state.secretNote}
            </p>
          ) : null}
          <div className={projectStyles.githubActions}>
            <Link href={`${NEW}?from=github`} className="button button-soft">
              Choose a different repository
            </Link>
            <Link href={NEW} className="button button-soft">
              Start without a repository
            </Link>
          </div>
        </>
      ) : null}
    </section>
  )
}

function Picker({
  choices,
}: {
  choices: StartChoices | { status: 'limited' }
}) {
  if (choices.status === 'limited') {
    return (
      <p role="alert" className={`on-pink ${projectStyles.notice}`}>
        {failureText.limited}
      </p>
    )
  }
  if (choices.status === 'error') {
    return (
      <p role="alert" className={`on-pink ${projectStyles.notice}`}>
        {choices.kind === 'rate_limited'
          ? failureText.rate_limited
          : choices.kind === 'unavailable'
            ? failureText.unavailable
            : failureText.failed}
      </p>
    )
  }
  if (choices.status === 'none') {
    return (
      <>
        <p className={projectStyles.help}>
          There are no repositories left to start from. Every repository this
          connection can see is already linked to one of your projects, or the
          app has not been given access to any.
        </p>
        <div className={projectStyles.githubActions}>
          <Link href={NEW} className="button button-soft">
            Start without a repository
          </Link>
        </div>
      </>
    )
  }

  // A plain GET form: choosing only reads, and never saves a project.
  return (
    <form method="get" action={NEW} className={projectStyles.startForm}>
      <label htmlFor="start-repo">Repository</label>
      <select
        id="start-repo"
        name="repo"
        required
        className={projectStyles.select}
        defaultValue=""
      >
        <option value="" disabled>
          Choose a repository
        </option>
        {choices.groups.map((group) => (
          <optgroup key={group.installationId} label={group.accountLogin}>
            {group.repos.map((repo) => (
              <option
                key={repo.fullName}
                value={`${String(group.installationId)}|${repo.fullName}`}
              >
                {repo.fullName}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className={projectStyles.help}>
        Repositories already linked to one of your projects are not listed.
      </p>
      <div className={projectStyles.githubActions}>
        <button type="submit" className="button">
          Use this repo
        </button>
        <Link href={NEW} className="button button-soft">
          Cancel
        </Link>
      </div>
    </form>
  )
}
