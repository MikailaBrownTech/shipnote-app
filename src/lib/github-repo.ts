// A repository as GitHub names it: "owner/repo". The same pattern is a check
// constraint on projects.repo_full_name (see the github_installations
// migration). Keep them in step.
const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/

export function isRepoFullName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    FULL_NAME.test(value) &&
    !/\/\.{1,2}$/.test(value)
  )
}

export function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner = '', repo = ''] = fullName.split('/')
  return { owner, repo }
}

// The commit page on github.com, built from values we validated ourselves and
// never taken from a GitHub response.
export function commitUrl(fullName: string, sha: string): string {
  const { owner, repo } = splitRepo(fullName)
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(sha)}`
}
