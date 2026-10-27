import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import shell from './shell.module.css'

// The right-hand column on dashboard pages: a picture card and a short list.
// Plain, honest copy: Shipnote drafts from notes, the person edits and copies,
// and nothing is posted for them.

function Illustration() {
  return (
    <svg
      viewBox="0 0 320 170"
      className={shell.illustration}
      role="presentation"
      aria-hidden="true"
    >
      <rect
        x="14"
        y="22"
        width="170"
        height="110"
        rx="16"
        fill="#fff"
        opacity=".85"
      />
      <circle cx="34" cy="40" r="5" fill="#ff006e" />
      <circle cx="50" cy="40" r="5" fill="#ffbe0b" />
      <circle cx="66" cy="40" r="5" fill="#2dd4bf" />
      <rect x="30" y="62" width="80" height="8" rx="4" fill="#e4def5" />
      <rect x="30" y="80" width="120" height="8" rx="4" fill="#e4def5" />
      <rect x="30" y="98" width="60" height="8" rx="4" fill="#e4def5" />
      <circle cx="58" cy="128" r="24" fill="#fff" />
      <g transform="translate(46 116) scale(1)" fill="#1c1833">
        <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
      </g>
      <path
        d="M96 118c30-4 40-34 70-36"
        fill="none"
        stroke="#8338ec"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 8"
      />
      <path
        d="m162 74 8 7-10 4"
        fill="none"
        stroke="#8338ec"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="244" cy="86" r="40" fill="#fff" />
      <rect x="222" y="66" width="44" height="40" rx="8" fill="#8338ec" />
      <rect x="230" y="76" width="28" height="4" rx="2" fill="#fff" />
      <rect x="230" y="85" width="22" height="4" rx="2" fill="#fff" />
      <rect x="230" y="94" width="26" height="4" rx="2" fill="#fff" />
      <path
        d="M292 20v12M306 26l-8 8"
        stroke="#1c1833"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Tips({ title, items }: { title: string; items: string[] }) {
  return (
    <section className={`${shell.railCard} ${shell.tipsCard}`}>
      <h2>
        <Icon name="bulb" size={20} />
        {title}
      </h2>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <span className={shell.tick}>
              <Icon name="check" size={13} />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Picture({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${shell.railCard} ${shell.pictureCard}`}>
      <Illustration />
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  )
}

export function FormRail() {
  return (
    <aside className={shell.rail} aria-label="Tips">
      <Picture title="Turn your notes into opportunities.">
        Add your project and Shipnote will help you draft LinkedIn posts from
        your notes. You edit a draft and copy it; Shipnote never posts for you.
      </Picture>
      <Tips
        title="Tips for a great project"
        items={[
          'Use a clear, descriptive name',
          'Add a short summary of what it does',
          'Include relevant context (README, goals, progress)',
          'Keep it public-friendly',
          'Never paste secrets or customer data',
        ]}
      />
    </aside>
  )
}

export function DetailRail() {
  return (
    <aside className={shell.rail} aria-label="What is next">
      <Picture title="Drafts are coming soon.">
        Once drafts are available, the ones made from this project will appear
        here. You will edit them and post them yourself.
      </Picture>
      <Tips
        title="Make the notes count"
        items={[
          'Recent progress beats old history',
          'Say what you built and why it matters',
          'Keep out anything you would not post publicly',
        ]}
      />
    </aside>
  )
}

export function AccountRail() {
  const rows: { icon: IconName; text: string }[] = [
    {
      icon: 'shield',
      text: 'Use Sign out everywhere (in the Account menu on the dashboard) if you lose a device.',
    },
    {
      icon: 'trash',
      text: 'Deleting your account is permanent, and your invite cannot be used again.',
    },
    {
      icon: 'book',
      text: 'Your projects are private. Only you can see them.',
    },
  ]
  return (
    <aside className={shell.rail} aria-label="Good to know">
      <section className={`${shell.railCard} ${shell.tipsCard}`}>
        <h2>
          <Icon name="shield" size={20} />
          Good to know
        </h2>
        <ul>
          {rows.map((row) => (
            <li key={row.text}>
              <span className={shell.tick}>
                <Icon name={row.icon} size={13} />
              </span>
              {row.text}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
