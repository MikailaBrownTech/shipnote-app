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

const points = [
  {
    title: 'Sounds like you',
    body: 'Drafts start from your own project docs and the commits you tag, so they read like your work.',
    icon: (
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    ),
    tone: 'on-violet',
  },
  {
    title: 'You stay in charge',
    body: 'Edit every word, then copy it. Shipnote never posts for you.',
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>
    ),
    tone: 'on-amber',
  },
  {
    title: 'Only what you pick',
    body: 'Commits without [post] are left alone.',
    icon: (
      <>
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
        <circle cx="7" cy="7" r="1.5" />
      </>
    ),
    tone: 'on-azure',
  },
]

const steps = [
  {
    title: 'Add your project',
    body: 'Link the repo and the docs that explain what you are building.',
  },
  {
    title: 'Tag a commit with [post]',
    body: 'Write commit messages the way you always do. Add [post] to the ones worth telling people about.',
  },
  {
    title: 'Edit and copy',
    body: 'Shipnote drafts the post. You change what you want, copy it, and publish it on LinkedIn yourself.',
  },
]

function toneOf(n: number) {
  return commits.find((commit) => commit.n === n)?.tone
}

export default function Home() {
  return (
    <>
      <div className={styles.heroWash}>
        <header className={`page ${styles.nav}`}>
          <Link href="/" className="wordmark">
            Shipnote
          </Link>
          <nav aria-label="Page sections" className={styles.links}>
            <a href="#example">Example</a>
            <a href="#how">How it works</a>
          </nav>
          <Link href="/sign-in" className="button">
            Sign in
          </Link>
        </header>

        <main>
          <section
            className={`page ${styles.hero}`}
            aria-labelledby="hero-title"
          >
            <div className={styles.pitch}>
              <p className="pill">Early access, invite only</p>
              <h1 id="hero-title">
                What you shipped this week, as a post that{' '}
                <span className={styles.accent}>sounds like you.</span>
              </h1>
              <p className={styles.lead}>
                Shipnote turns your project docs and the commits you tag into a
                LinkedIn draft. You edit it and copy it. It never posts for you.
              </p>
              <div className={styles.actions}>
                <Link href="/sign-in" className="button">
                  Sign in
                </Link>
                <a href="#example" className="button button-soft">
                  See an example
                </a>
              </div>
              <ul className={styles.checks}>
                <li>You edit every draft</li>
                <li>You copy it yourself</li>
                <li>Never posts for you</li>
              </ul>
            </div>

            <figure id="example" className={styles.example}>
              <div className={styles.window}>
                <div className={styles.chrome} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <b>Tidepool</b>
                </div>

                <div className={styles.windowBody}>
                  <h2 className={styles.label}>Your commits</h2>
                  <ol className={styles.commits}>
                    {commits.map((commit) => (
                      <li
                        key={commit.hash}
                        className={commit.tone ?? styles.skipped}
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

                  <svg
                    className={styles.arrow}
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </svg>

                  <h2 className={styles.label}>Your draft</h2>
                  <p className={styles.draft}>
                    This week on Tidepool.{' '}
                    {sentences.map((sentence, index) => (
                      <span key={sentence.n}>
                        <span
                          className={`${styles.mark} ${toneOf(sentence.n) ?? ''}`}
                          style={{
                            animationDelay: `${String(500 + index * 450)}ms`,
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

              <p className={styles.chip}>You copy it. Shipnote never posts.</p>
              <figcaption className={styles.caption}>
                An example from a made-up project called Tidepool
              </figcaption>
            </figure>
          </section>
        </main>
      </div>

      <section className={`page ${styles.points}`} aria-label="Why Shipnote">
        <ul>
          {points.map((point) => (
            <li key={point.title}>
              <span className={`${styles.icon} ${point.tone}`}>
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {point.icon}
                </svg>
              </span>
              <h2>{point.title}</h2>
              <p>{point.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="how"
        className={`page ${styles.how}`}
        aria-labelledby="how-title"
      >
        <h2 id="how-title">
          From commits to a post in{' '}
          <span className={styles.accent}>three steps.</span>
        </h2>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title}>
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
        className={`page ${styles.editWrap}`}
        aria-labelledby="edit-title"
      >
        <div className={styles.edit}>
          <figure className={styles.editor} aria-hidden="true">
            <div className={styles.chrome}>
              <span />
              <span />
              <span />
              <b>Edit your draft</b>
            </div>
            <div className={styles.editorBody}>
              <p>
                This week on Tidepool. You can now export any usage report as a
                CSV file. I also got the report page loading in 2 seconds
                instead of 9. And one bug I am glad is gone: weekly totals were
                off by a day for anyone outside UTC.
              </p>
              <p className={styles.editorBar}>
                <span>Example draft</span>
                <b>Copy</b>
              </p>
            </div>
          </figure>

          <div className={styles.editText}>
            <h2 id="edit-title">You edit it. You copy it. You post it.</h2>
            <p>
              Change anything in the draft. When it reads right, copy it and
              publish it on LinkedIn yourself. Shipnote never posts for you.
            </p>
            <Link href="/sign-in" className="button">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section
        className={`page ${styles.closeWrap}`}
        aria-labelledby="close-title"
      >
        <div className={styles.close}>
          <h2 id="close-title">
            Got an invite? Sign in and start with one commit.
          </h2>
          <p>Shipnote is in early access, invite only.</p>
          <Link href="/sign-in" className="button button-amber">
            Sign in
          </Link>
        </div>
      </section>

      <footer className={`page ${styles.footer}`}>
        <Link href="/" className="wordmark">
          Shipnote
        </Link>
        <p>Shipnote is in early access. It never posts to LinkedIn for you.</p>
      </footer>
    </>
  )
}
