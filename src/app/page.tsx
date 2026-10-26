import Link from 'next/link'
import type { CSSProperties } from 'react'
import styles from './landing.module.css'

type Commit = {
  n: number
  hash: string
  message: string
  tagged: boolean
  color?: string
}

// A made-up project, so nothing here is a real customer or repo.
const commits: Commit[] = [
  {
    n: 1,
    hash: 'a3f9c21',
    message: 'Add CSV export to the usage report',
    tagged: true,
    color: 'var(--amber-gold)',
  },
  {
    n: 2,
    hash: 'b81d07e',
    message: 'Cut report load time from 9s to 2s',
    tagged: true,
    color: 'var(--azure-blue)',
  },
  {
    n: 3,
    hash: 'c04e5aa',
    message: 'Fix timezone bug that shifted weekly totals',
    tagged: true,
    color: 'var(--neon-pink)',
  },
  {
    n: 0,
    hash: 'd19b3f0',
    message: 'Bump eslint',
    tagged: false,
  },
]

const sentences = [
  { n: 1, text: 'You can now export any usage report as a CSV file.' },
  {
    n: 2,
    text: 'I also got the report page loading in 2 seconds instead of 9.',
  },
  {
    n: 3,
    text: 'And one bug I am glad is gone: weekly totals were off by a day for anyone outside UTC.',
  },
]

const steps = [
  {
    title: 'Add your project',
    body: 'Link the repo and the docs that explain what you are building.',
    fill: 'var(--amber-gold)',
    text: 'var(--ink)',
  },
  {
    title: 'Tag a commit with [post]',
    body: 'Write commit messages the way you always do. Add [post] to the ones worth telling people about.',
    fill: 'var(--blaze-orange)',
    text: 'var(--ink)',
  },
  {
    title: 'Edit and copy',
    body: 'Shipnote drafts the post. You change what you want, copy it, and publish it on LinkedIn yourself.',
    fill: 'var(--blue-violet)',
    text: 'var(--on-violet)',
  },
]

function colorOf(n: number) {
  return commits.find((commit) => commit.n === n)?.color
}

export default function Home() {
  return (
    <>
      <header className={`page ${styles.header}`}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
        <Link href="/sign-in" className={styles.headerLink}>
          Sign in
        </Link>
      </header>

      <main>
        <section className={`page ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.pitch}>
            <h1 id="hero-title">
              What you shipped this week, as a post that sounds like you.
            </h1>
            <p className={styles.lead}>
              Shipnote turns your project docs and the commits you tag into a
              LinkedIn draft. You edit it and copy it. It never posts for you.
            </p>
            <p className={styles.access}>Early access, invite only.</p>
            <Link href="/sign-in" className="button">
              Sign in
            </Link>
          </div>

          <figure className={styles.example}>
            <figcaption>
              An example from a made-up project called Tidepool
            </figcaption>

            <div className={styles.pair}>
              <div>
                <h2 className={styles.label}>Commits</h2>
                <ol className={styles.commits}>
                  {commits.map((commit) => (
                    <li
                      key={commit.hash}
                      className={commit.tagged ? styles.tagged : styles.skipped}
                      style={{ '--c': commit.color } as CSSProperties}
                    >
                      {commit.tagged ? (
                        <span className={styles.ref}>{commit.n}</span>
                      ) : null}
                      <code>
                        {commit.hash}{' '}
                        {commit.tagged ? (
                          <b className={styles.tag}>[post]</b>
                        ) : null}{' '}
                        {commit.message}
                      </code>
                      {commit.tagged ? null : (
                        <span className={styles.note}>
                          Not tagged, so skipped
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h2 className={styles.label}>The draft</h2>
                <p className={styles.draft}>
                  This week on Tidepool.{' '}
                  {sentences.map((sentence) => (
                    <span key={sentence.n}>
                      <span
                        className={styles.mark}
                        style={
                          {
                            '--c': colorOf(sentence.n),
                            '--i': sentence.n - 1,
                          } as CSSProperties
                        }
                      >
                        {sentence.text}
                        <sup className={styles.sup}>{sentence.n}</sup>
                      </span>{' '}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </figure>
        </section>

        <section className={`page ${styles.how}`} aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span
                  className={styles.num}
                  style={
                    { background: step.fill, color: step.text } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          className={`page ${styles.close}`}
          aria-labelledby="close-title"
        >
          <h2 id="close-title">
            Got an invite? Sign in and start with one commit.
          </h2>
          <Link href="/sign-in" className="button">
            Sign in
          </Link>
        </section>
      </main>

      <footer className={`page ${styles.footer}`}>
        <div className={styles.bar} aria-hidden="true">
          <span style={{ background: 'var(--amber-gold)' }} />
          <span style={{ background: 'var(--blaze-orange)' }} />
          <span style={{ background: 'var(--neon-pink)' }} />
          <span style={{ background: 'var(--blue-violet)' }} />
          <span style={{ background: 'var(--azure-blue)' }} />
        </div>
        <p>Shipnote is in early access. It never posts to LinkedIn for you.</p>
      </footer>
    </>
  )
}
