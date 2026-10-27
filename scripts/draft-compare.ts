/* eslint-disable no-console -- a command-line tool: printing is its output. */
// Compares the models on a few made-up projects, so the model and the prompt
// can be chosen by looking at real output and real cost. Run by hand:
//
//   ANTHROPIC_API_KEY=... pnpm draft:compare
//   ANTHROPIC_API_KEY=... pnpm draft:compare --models=claude-haiku-5-5
//
// It makes one call per sample per model (6 by default, a few cents), with no
// retries. The samples below are invented: no real project, commit, note or
// account is read, and nothing is stored. The drafts are printed so you can
// read them; keep the output to yourself if you change the samples to real
// text. The key is read from the environment and never printed.
//
// Needs Node 22.18 or later (it runs the TypeScript files directly).

import {
  costMicrousd,
  messagesRequestBody,
  MODELS,
  modelConfig,
  type Usage,
} from '../src/lib/ai-models.ts'
import { checkDraft } from '../src/lib/draft-checker.ts'
import { buildDraftInput, inputText } from '../src/lib/draft-input.ts'
import { validateDraftOutput } from '../src/lib/draft-output.ts'
import { buildUserMessage, SYSTEM_PROMPT } from '../src/lib/draft-prompt.ts'
import { countWords } from '../src/lib/draft-rules.ts'

const URL = 'https://api.anthropic.com/v1/messages'

const SAMPLES = [
  {
    label: 'in progress, commits only',
    stage: 'in_progress' as const,
    name: 'Recipe Planner',
    summary: 'A weekly meal planner that builds a shopping list.',
    notes: '',
    commits: [
      {
        sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
        message:
          'Group the shopping list by aisle [post]\n\nItems used to come back in the order they were added. They are now sorted by aisle, with a "misc" group at the end.',
      },
      {
        sha: 'b1c2d3e4f5a6b7c8d9e0b1c2d3e4f5a6b7c8d9e0',
        message:
          'Fix duplicate items when two recipes share an ingredient [post]',
      },
    ],
    note: '',
  },
  {
    label: 'idea, notes and a note',
    stage: 'idea' as const,
    name: 'Trail Log',
    summary: 'A small app for logging hikes offline.',
    notes:
      'Hikers lose signal on most trails, so the log has to work with no network and sync later. Thinking about a local-first store. Not sure yet whether to build a phone app or a web app that installs.',
    commits: [],
    note: 'I keep going back and forth on web versus native.',
  },
  {
    label: 'shipped, one commit and notes',
    stage: 'shipped' as const,
    name: 'Invoice Nudge',
    summary: 'Sends a polite reminder when an invoice is overdue.',
    notes:
      'Freelancers hate chasing payments. The reminder goes out three days after the due date and stops once the invoice is marked paid.',
    commits: [
      {
        sha: 'c1d2e3f4a5b6c7d8e9f0c1d2e3f4a5b6c7d8e9f0',
        message: 'Stop reminders as soon as an invoice is marked paid [post]',
      },
    ],
    note: '',
  },
]

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

const key = process.env.ANTHROPIC_API_KEY
if (!key) {
  console.error('Set ANTHROPIC_API_KEY in your shell first.')
  process.exit(1)
}

const ids = (arg('models') ?? Object.keys(MODELS).join(',')).split(',')
for (const id of ids) {
  if (!modelConfig(id)) {
    console.error(
      `Unknown model: ${id}. Known: ${Object.keys(MODELS).join(', ')}`,
    )
    process.exit(1)
  }
}

const totals = new Map<string, number>()

for (const sample of SAMPLES) {
  const data = buildDraftInput({
    stage: sample.stage,
    name: sample.name,
    summary: sample.summary,
    notes: sample.notes,
    commits: sample.commits,
    note: sample.note,
  })
  for (const id of ids) {
    const model = modelConfig(id)
    if (!model) continue
    const nonce = Math.random().toString(16).slice(2, 18).padEnd(16, '0')
    const body = messagesRequestBody({
      model,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(data, nonce),
    })

    console.log(`\n=== ${sample.label} | ${id} ===`)
    let response: Response
    try {
      response = await fetch(URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      console.log('request failed (network or timeout)')
      continue
    }
    if (!response.ok) {
      console.log(`request failed: HTTP ${String(response.status)}`)
      continue
    }
    const json = (await response.json()) as {
      content?: { type: string; text?: string }[]
      usage?: Usage
      stop_reason?: string
    }
    const text = (json.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    const usage = json.usage ?? { input_tokens: 0, output_tokens: 0 }
    const cost = costMicrousd(model, usage)
    totals.set(id, (totals.get(id) ?? 0) + cost)

    const checked = validateDraftOutput(text, {
      nonce,
      stopReason: json.stop_reason ?? null,
    })
    console.log(text)
    console.log('---')
    console.log(
      `${String(countWords(text))} words | ${String(usage.input_tokens)} in, ${String(usage.output_tokens)} out | $${(cost / 1_000_000).toFixed(5)}`,
    )
    console.log(
      checked.ok
        ? 'output check: passed'
        : `output check: REJECTED (${checked.reason})`,
    )
    if (checked.ok) {
      const warnings = checkDraft({
        body: checked.body,
        stage: sample.stage,
        inputText: inputText(data),
      })
      console.log(
        warnings.length === 0
          ? 'authenticity warnings: none'
          : `authenticity warnings: ${warnings.map((w) => w.code).join(', ')}`,
      )
    }
  }
}

console.log('\n=== total cost for this run ===')
for (const [id, cost] of totals) {
  console.log(`${id}: $${(cost / 1_000_000).toFixed(5)}`)
}
