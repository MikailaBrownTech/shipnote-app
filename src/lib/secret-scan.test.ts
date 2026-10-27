import { describe, expect, it } from 'vitest'
import { describeSecrets, findSecrets } from './secret-scan'

// The fake keys are assembled at run time from pieces, so nothing that looks
// like a real credential is written into the repository.
const cat = (...parts: string[]) => parts.join('')
const fill = (char: string, n: number) => char.repeat(n)
const alnum = (n: number) => 'aB3xY9'.repeat(Math.ceil(n / 6)).slice(0, n)

const ghToken = (n = 36) => cat('gh', 'p', '_', alnum(n))
const stripeKey = () => cat('sk', '_live_', alnum(24))
const anthropicKey = () => cat('sk', '-ant-', 'api03-', alnum(40))
const awsKeyId = () => cat('AK', 'IA', fill('A', 16))

const positives: [string, string][] = [
  ['private key header', cat('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----')],
  ['private key header', cat('-----BEGIN ', 'PRIVATE KEY-----')],
  ['private key header', cat('-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----')],
  ['private key header', cat('-----BEGIN ', 'EC ', 'PRIVATE KEY-----')],
  ['private key header', cat('-----BEGIN ', 'PGP ', 'PRIVATE KEY BLOCK-----')],
  ['GitHub token', ghToken()],
  ['GitHub token', cat('gh', 'o', '_', alnum(40))],
  ['GitHub token', cat('gh', 's', '_', alnum(36))],
  ['GitHub token', cat('github', '_pat_', alnum(60))],
  ['AWS access key ID', awsKeyId()],
  ['AWS access key ID', cat('AS', 'IA', fill('B', 16))],
  ['AWS secret access key', cat('aws_secret_access_key = ', alnum(40))],
  ['AWS secret access key', cat('AWS_SECRET_ACCESS_KEY="', alnum(40), '"')],
  ['Stripe secret key', stripeKey()],
  ['Stripe secret key', cat('sk', '_test_', alnum(24))],
  ['Stripe secret key', cat('rk', '_live_', alnum(24))],
  ['Stripe webhook secret', cat('whsec', '_', alnum(32))],
  ['Anthropic API key', anthropicKey()],
  ['OpenAI API key', cat('sk', '-', alnum(48))],
  ['OpenAI API key', cat('sk', '-proj-', alnum(48))],
  ['Slack token', cat('xox', 'b', '-', alnum(24))],
  ['Google API key', cat('AI', 'za', alnum(35))],
  [
    'signed access token (JWT)',
    cat('ey', 'J', alnum(20), '.ey', 'J', alnum(30), '.', alnum(30)),
  ],
]

describe('findSecrets: things it should catch', () => {
  it.each(positives)('finds a %s (%#)', (kind, secret) => {
    const found = findSecrets(cat('some words ', secret, ' more words'))
    expect(found.map((f) => f.kind)).toContain(kind)
  })

  it('reports the line number, counting from 1', () => {
    const text = [
      '# Title',
      '',
      'Setup:',
      cat('  export KEY=', stripeKey()),
    ].join('\n')
    expect(findSecrets(text)).toEqual([{ kind: 'Stripe secret key', line: 4 }])
  })

  it('counts lines the same for LF, CRLF and CR line breaks', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      expect(findSecrets(['a', 'b', ghToken()].join(eol))).toEqual([
        { kind: 'GitHub token', line: 3 },
      ])
    }
  })

  it('finds several kinds and several lines', () => {
    const text = [
      cat('token: ', ghToken()),
      'nothing here',
      cat('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'),
    ].join('\n')
    expect(findSecrets(text)).toEqual([
      { kind: 'GitHub token', line: 1 },
      { kind: 'private key header', line: 3 },
    ])
  })

  it('names an Anthropic key as Anthropic only, not also as OpenAI', () => {
    expect(findSecrets(anthropicKey())).toEqual([
      { kind: 'Anthropic API key', line: 1 },
    ])
  })

  it('reports a kind once per line', () => {
    const reversed = ghToken().split('').reverse().join('')
    expect(
      findSecrets(cat(ghToken(), ' and ', cat('gh', 'p', '_', reversed))),
    ).toHaveLength(1)
  })

  it('stops at a sensible number of findings', () => {
    const lines = Array.from({ length: 100 }, () => ghToken())
    expect(findSecrets(lines.join('\n')).length).toBeLessThanOrEqual(20)
  })

  it('finds a key inside Markdown, JSON and shell snippets', () => {
    const key = stripeKey()
    for (const text of [
      cat('```\nSTRIPE_KEY=', key, '\n```'),
      cat('{"stripe": "', key, '"}'),
      cat('curl -u ', key, ': https://api.example.test'),
      cat('**key:** ', key),
    ]) {
      expect(findSecrets(text).map((f) => f.kind)).toContain(
        'Stripe secret key',
      )
    }
  })
})

describe('findSecrets: ordinary text it should leave alone', () => {
  it.each([
    '',
    'A short note.',
    '# My project\n\nA modern web app built with Next.js and Supabase.',
    'Run `npm install` then `npm run dev`.',
    'Set STRIPE_SECRET_KEY in your environment.',
    'Add your key like sk_live_YOUR_KEY_HERE',
    'The format is ghp_ followed by characters',
    'Use a token that starts with sk- when you call the API',
    'AKIA is the prefix of AWS access keys',
    '-----BEGIN CERTIFICATE-----',
    '-----BEGIN PUBLIC KEY-----',
    'my password is hunter2',
    'https://github.com/octo/hello/commit/0123456789abcdef0123456789abcdef01234567',
    'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    'The quick brown fox jumps over the lazy dog',
    'sk-short',
    'eyJ.eyJ.sig',
    'user@example.com',
    'v1.2.3-beta.4',
    'ghp_short',
    'pk_live_publishable_keys_are_public_anyway_1234567890',
  ])('does not flag: %s', (text) => {
    expect(findSecrets(text)).toEqual([])
  })

  it('does not flag a long ordinary README', () => {
    const readme = Array.from({ length: 200 }, (_, i) =>
      cat(
        'Line ',
        String(i),
        ': Shipnote turns commits into drafts you edit and copy.',
      ),
    ).join('\n')
    expect(findSecrets(readme)).toEqual([])
  })

  it('does not flag a git commit sha or a UUID', () => {
    expect(
      findSecrets(
        'commit 9fceb02d0ae598e95dc970b74767f19372d61af8 and 6f1c3a9e-1b2d-4c3e-8f4a-5b6c7d8e9f01',
      ),
    ).toEqual([])
  })
})

describe('describeSecrets', () => {
  it('says what kind and where, and never includes the text', () => {
    const secret = ghToken()
    const found = findSecrets(cat('line one\ntoken ', secret))
    const message = describeSecrets(found, 'the notes')
    expect(message).toBe(
      'Possible secret in the notes: a GitHub token on line 2. Remove it, then save again. This is a basic check and does not catch everything.',
    )
    expect(message).not.toContain(secret)
    expect(message).not.toContain(secret.slice(4, 20))
  })

  it('uses "an" before a vowel', () => {
    expect(describeSecrets(findSecrets(awsKeyId()), 'the notes')).toContain(
      'an AWS access key ID on line 1',
    )
  })

  it('lists up to three findings and counts the rest', () => {
    const findings = [
      { kind: 'GitHub token', line: 1 },
      { kind: 'Slack token', line: 2 },
      { kind: 'Google API key', line: 3 },
      { kind: 'Stripe secret key', line: 4 },
      { kind: 'private key header', line: 5 },
    ]
    const message = describeSecrets(findings, 'the notes')
    expect(message).toContain(
      'a GitHub token on line 1, a Slack token on line 2 and a Google API key on line 3, and 2 more',
    )
    expect(message).not.toContain('line 4')
  })

  it('names the part of the form', () => {
    expect(
      describeSecrets([{ kind: 'Slack token', line: 1 }], 'the summary'),
    ).toContain('in the summary')
  })
})
