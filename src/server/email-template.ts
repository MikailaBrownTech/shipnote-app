import type { BrowserFamily } from '@/lib/device'

export type AlertMethod = 'github' | 'email'

const METHOD_LABEL: Record<AlertMethod, string> = {
  github: 'GitHub',
  email: 'An email link',
}

type AlertInput = {
  siteUrl: string
  at: Date
  method: AlertMethod
  browser: BrowserFamily
}

// "2026-10-26 12:00 UTC"
function formatWhen(at: Date) {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Every value here comes from a fixed list (method, browser) or from the
// server (time, site URL). Nothing a visitor typed or sent reaches the email,
// and it carries no token and no sign-in link: the one link goes to the
// dashboard, where the person has to sign in as usual.
export function buildSignInAlert({ siteUrl, at, method, browser }: AlertInput) {
  const when = formatWhen(at)
  const how = METHOD_LABEL[method]
  const link = `${siteUrl}/dashboard`

  const text = [
    'There was a new sign-in to your Shipnote account.',
    '',
    `When: ${when}`,
    `How: ${how}`,
    `Browser: ${browser}`,
    '',
    `Not you? Sign in and choose Sign out everywhere: ${link}`,
    '',
    'This email has no sign-in link. If this was you, you can ignore it.',
  ].join('\n')

  const html = [
    '<p>There was a new sign-in to your Shipnote account.</p>',
    '<ul>',
    `<li>When: ${escapeHtml(when)}</li>`,
    `<li>How: ${escapeHtml(how)}</li>`,
    `<li>Browser: ${escapeHtml(browser)}</li>`,
    '</ul>',
    `<p>Not you? <a href="${escapeHtml(link)}">Sign in and choose Sign out everywhere</a>.</p>`,
    '<p>This email has no sign-in link. If this was you, you can ignore it.</p>',
  ].join('\n')

  return { subject: 'New sign-in to Shipnote', text, html }
}
