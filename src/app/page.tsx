import Link from 'next/link'
import styles from './landing.module.css'

type Commit = {
  n: number
  hash: string
  message: string
  tagged: boolean
  tone?: string
}

// A made-up project, so nothing here is a real customer or repo.
const commits: Commit[] = [
  {
    n: 1,
    hash: 'a3f9c21',
    message: 'Add CSV export to the usage report',
    tagged: true,
    tone: 'on-amber',
  },
  {
    n: 2,
    hash: 'b81d07e',
    message: 'Cut report load time from 9s to 2s',
    tagged: true,
    tone: 'on-azure',
  },
  {
    n: 3,
    hash: 'c04e5aa',
    message: 'Fix timezone bug that shifted weekly totals',
    tagged: true,
    tone: 'on-pink',
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
    tone: 'on-orange',
  },
  {
    title: 'Tag a commit with [post]',
    body: 'Write commit messages the way you always do. Add [post] to the ones worth telling people about.',
    tone: 'on-amber',
  },
  {
    title: 'Edit and copy',
    body: 'Shipnote drafts the post. You change what you want, copy it, and publish it on LinkedIn yourself.',
    tone: 'on-azure',
  },
]

function toneOf(n: number) {
  return commits.find((commit) => commit.n === n)?.tone
}

export default function Home() {
  return (
    <>
      <header className={`page ${styles.header}`}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
        <Link href="/sign-in" className="button">
          Sign in
        </Link>
      </header>

      <main>
        <section className={`page ${styles.hero}`} aria-labelledby="hero-title">
          <div className={`box on-violet ${styles.title}`}>
            <h1 id="hero-title">
              What you shipped this week, as a post that sounds like you.
            </h1>
            <p className={styles.lead}>
              Shipnote turns your project docs and the commits you tag into a
              LinkedIn draft. You edit it and copy it. It never posts for you.
            </p>
          </div>

          <div className={`box on-orange ${styles.side}`}>
            <p className={styles.access}>Early access, invite only.</p>
            <Link href="/sign-in" className="button">
              Sign in
            </Link>
          </div>

          <figure className={`box on-paper ${styles.example}`}>
            <figcaption className={`box on-amber ${styles.caption}`}>
              An example from a made-up project called Tidepool
            </figcaption>

            <div className={styles.pair}>
              <div>
                <h2 className={styles.label}>Commits</h2>
                <ol className={styles.commits}>
                  {commits.map((commit) => (
                    <li key={commit.hash} className={commit.tone ?? 'on-paper'}>
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

              <div className={`box on-paper ${styles.draftBox}`}>
                <h2 className={styles.label}>The draft</h2>
                <p className={styles.draft}>
                  This week on Tidepool.{' '}
                  {sentences.map((sentence, index) => (
                    <span key={sentence.n}>
                      <span
                        className={`${styles.mark} ${toneOf(sentence.n) ?? ''}`}
                        style={{
                          animationDelay: `${String(400 + index * 450)}ms`,
                        }}
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
          <h2 id="how-title" className={`box on-paper ${styles.howTitle}`}>
            How it works
          </h2>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li
                key={step.title}
                className={`box press ${step.tone} ${styles.step}`}
              >
                <span className={styles.num} aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className={`page ${styles.close}`}
          aria-labelledby="close-title"
        >
          <div className={`box on-pink ${styles.closeBox}`}>
            <h2 id="close-title">
              Got an invite? Sign in and start with one commit.
            </h2>
            <Link href="/sign-in" className="button">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className={`page ${styles.footer}`}>
        <div className={styles.swatches} aria-hidden="true">
          <span className="on-amber" />
          <span className="on-orange" />
          <span className="on-pink" />
          <span className="on-violet" />
          <span className="on-azure" />
        </div>
        <p className={`box on-paper ${styles.footnote}`}>
          Shipnote is in early access. It never posts to LinkedIn for you.
        </p>
      </footer>
    </>
  )
}
