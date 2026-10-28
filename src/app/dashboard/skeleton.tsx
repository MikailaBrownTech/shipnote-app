import styles from './skeleton.module.css'

// What a page shows while it loads: grey shapes where the content will be, in
// the page's own layout, instead of a line of text. One announcement ("Loading")
// is read out; the shapes themselves are hidden from screen readers. The
// shimmer stops for anyone who asks for less motion.

function Block({ className = '' }: { className?: string }) {
  return <span className={`${styles.block} ${className}`} aria-hidden="true" />
}

function ListRow() {
  return (
    <span className={styles.row}>
      <Block className={styles.icon} />
      <span className={styles.lines}>
        <Block className={styles.lineWide} />
        <Block className={styles.lineShort} />
      </span>
    </span>
  )
}

// A few grey lines, for a part of a page that loads on its own.
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={styles.rows}
    >
      <span className={styles.srOnly}>Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} aria-hidden="true">
          <ListRow />
        </span>
      ))}
    </div>
  )
}

// A whole page: a title, then the parts it has.
export function PageSkeleton({
  back = false,
  tabs = false,
  tiles = 0,
  rows = 0,
  form = 0,
  side = false,
}: {
  // A back link above the title.
  back?: boolean
  // A row of tabs under the title.
  tabs?: boolean
  // A row of stat tiles.
  tiles?: number
  // Rows in a list card.
  rows?: number
  // Fields in a form card.
  form?: number
  // A column of cards beside the main one.
  side?: boolean
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={styles.page}
    >
      <span className={styles.srOnly}>Loading</span>
      <div aria-hidden="true" className={styles.intro}>
        {back ? <Block className={styles.back} /> : null}
        <Block className={styles.title} />
        <Block className={styles.subtitle} />
      </div>

      {tabs ? (
        <div aria-hidden="true" className={styles.tabs}>
          {[0, 1, 2, 3].map((n) => (
            <Block key={n} className={styles.tab} />
          ))}
        </div>
      ) : null}

      {tiles > 0 ? (
        <div aria-hidden="true" className={styles.tiles}>
          {Array.from({ length: tiles }, (_, n) => (
            <Block key={n} className={styles.tile} />
          ))}
        </div>
      ) : null}

      <div aria-hidden="true" className={side ? styles.twoCol : styles.oneCol}>
        <div className={styles.stack}>
          {rows > 0 ? (
            <div className={styles.card}>
              <Block className={styles.cardTitle} />
              {Array.from({ length: rows }, (_, n) => (
                <ListRow key={n} />
              ))}
            </div>
          ) : null}
          {form > 0 ? (
            <div className={styles.card}>
              {Array.from({ length: form }, (_, n) => (
                <span key={n} className={styles.field}>
                  <Block className={styles.label} />
                  <Block
                    className={n % 2 === 0 ? styles.input : styles.textarea}
                  />
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {side ? (
          <div className={styles.stack}>
            <Block className={styles.sideCard} />
            <Block className={styles.sideCardShort} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
