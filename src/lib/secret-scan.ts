// A BASIC check for things that look like secrets, run on a project's text
// before it is saved. It catches well-known key shapes (private key headers and
// the prefixes of common API keys and tokens). It is not a full secret scanner:
// it will miss plain passwords, unusual key formats and anything it does not
// have a pattern for, and an example key in documentation will be flagged.
//
// It never returns or logs the text it matched. A finding is only a kind and a
// line number.

type Rule = { kind: string; pattern: RegExp }

// Listed most specific first: when two rules match the same characters, the
// first one names it (an Anthropic key also looks like an OpenAI key).
const RULES: readonly Rule[] = [
  {
    kind: 'private key header',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    kind: 'GitHub token',
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255})\b/g,
  },
  {
    kind: 'AWS access key ID',
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/g,
  },
  {
    kind: 'AWS secret access key',
    pattern:
      /aws_secret_access_key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  },
  {
    kind: 'Stripe secret key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  { kind: 'Stripe webhook secret', pattern: /\bwhsec_[0-9A-Za-z]{24,}\b/g },
  { kind: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  {
    kind: 'OpenAI API key',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g,
  },
  { kind: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  {
    kind: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
  },
  {
    kind: 'signed access token (JWT)',
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
]

export type SecretFinding = { kind: string; line: number }

const MAX_FINDINGS = 20

// Looks at the text line by line. Each kind is reported once per line.
export function findSecrets(text: string): SecretFinding[] {
  const found: SecretFinding[] = []
  const lines = text.split(/\r\n|\r|\n/)

  for (const [index, line] of lines.entries()) {
    if (line.length < 8) continue

    const taken: [number, number][] = []
    const kindsOnLine = new Set<string>()

    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) {
        const start = match.index
        const end = start + match[0].length
        // Already named by an earlier, more specific rule.
        if (taken.some(([s, e]) => start < e && end > s)) continue
        taken.push([start, end])
        if (!kindsOnLine.has(rule.kind)) {
          kindsOnLine.add(rule.kind)
          found.push({ kind: rule.kind, line: index + 1 })
          if (found.length >= MAX_FINDINGS) return found
        }
      }
    }
  }
  return found
}

const article = (kind: string) => (/^[aeiou]/i.test(kind) ? 'an' : 'a')

// A plain message that says what kind of pattern and where, never the text
// itself. `where` is the part of the form ("the notes", "the summary").
export function describeSecrets(
  findings: readonly SecretFinding[],
  where: string,
  // What to do again once it is removed: "save", "copy", "open the review".
  then = 'save',
): string {
  const shown = findings
    .slice(0, 3)
    .map((f) => `${article(f.kind)} ${f.kind} on line ${String(f.line)}`)
  const more = findings.length - shown.length
  const list =
    shown.length === 1
      ? (shown[0] ?? '')
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1] ?? ''}`
  const extra = more > 0 ? `, and ${String(more)} more` : ''
  return `Possible secret in ${where}: ${list}${extra}. Remove it, then ${then} again. This is a basic check and does not catch everything.`
}

// The message to show for a text that looks like it holds a secret, or null if it
// does not. One function for the places that only need to know "is it clean, and
// if not, what do I say": the draft save, copy and review, in the browser and on
// the server.
export function secretProblem(
  text: string,
  where: string,
  then = 'save',
): string | null {
  const found = findSecrets(text)
  return found.length > 0 ? describeSecrets(found, where, then) : null
}
