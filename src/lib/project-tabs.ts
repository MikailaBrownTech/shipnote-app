// The tabs on a project page. The current tab is the ?tab= value, checked
// against this fixed list; anything else is ignored.
export const PROJECT_TABS = ['overview', 'github', 'notes'] as const

export type ProjectTab = (typeof PROJECT_TABS)[number]

// The tab to show. The GitHub tab exists only while the feature is on. With no
// valid ?tab=, a page that arrives with a GitHub message (after connecting,
// linking and so on) opens on the GitHub tab, where that message belongs.
export function chooseTab(input: {
  value: unknown
  githubOn: boolean
  hasGithubMessage: boolean
}): ProjectTab {
  const asked = PROJECT_TABS.find((tab) => tab === input.value)
  if (asked === 'github' && !input.githubOn) return 'overview'
  if (asked) return asked
  return input.githubOn && input.hasGithubMessage ? 'github' : 'overview'
}
