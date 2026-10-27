// The only values ?github= may carry on a dashboard page. The page shows fixed
// wording for a known code and ignores anything else, so nothing in the URL is
// ever echoed back.
export const GITHUB_FLASH = [
  'connected',
  'expired', // the connect attempt timed out or did not start here
  'invalid', // GitHub could not confirm the installation is this person's
  'denied', // GitHub refused or the person did not allow access
  'org', // an organization installation, not supported yet
  'taken', // that installation is connected to another Shipnote account
  'limited',
  'repo', // the chosen repository is not available through the connection
  'repotaken', // another of the user's projects already uses that repository
  'linkfailed', // the project was created but the repository could not be linked
  'unavailable', // GitHub is down or slow
  'failed',
  'linked',
  'unlinked',
  'disconnected',
] as const

export type GithubFlash = (typeof GITHUB_FLASH)[number]

export function parseGithubFlash(value: unknown): GithubFlash | null {
  return GITHUB_FLASH.find((code) => code === value) ?? null
}

export const GITHUB_FLASH_MESSAGES: Record<
  GithubFlash,
  { tone: 'good' | 'bad'; text: string }
> = {
  connected: { tone: 'good', text: 'GitHub connected' },
  expired: {
    tone: 'bad',
    text: 'That connection attempt expired. Start again from the project page.',
  },
  invalid: {
    tone: 'bad',
    text: 'We could not confirm that GitHub installation is yours. Nothing was saved.',
  },
  denied: {
    tone: 'bad',
    text: 'GitHub did not give us access. Nothing was saved. Try again.',
  },
  org: {
    tone: 'bad',
    text: 'Organization installations are not supported yet. Install the app on your personal account.',
  },
  taken: {
    tone: 'bad',
    text: 'That GitHub account is already connected to another Shipnote account.',
  },
  limited: {
    tone: 'bad',
    text: 'Too many attempts. Try again in a few minutes.',
  },
  repo: {
    tone: 'bad',
    text: 'That repository is not available through your GitHub connection. Nothing was saved.',
  },
  repotaken: {
    tone: 'bad',
    text: 'That repository is already linked to another of your projects.',
  },
  linkfailed: {
    tone: 'bad',
    text: 'The project was created, but the repository could not be linked. You can link it from here.',
  },
  unavailable: {
    tone: 'bad',
    text: 'GitHub is not responding right now. Try again in a moment.',
  },
  failed: { tone: 'bad', text: 'Something went wrong. Nothing was saved.' },
  linked: { tone: 'good', text: 'Repository linked.' },
  unlinked: { tone: 'good', text: 'Repository unlinked.' },
  disconnected: {
    tone: 'good',
    text: 'GitHub disconnected from Shipnote. The app is still installed on GitHub; remove it there if you want it gone.',
  },
}

// A same-site path with ?github=<code> added.
export function withFlash(path: string, code: GithubFlash): string {
  const url = new URL(path, 'http://shipnote.invalid')
  url.searchParams.set('github', code)
  return `${url.pathname}${url.search}`
}
