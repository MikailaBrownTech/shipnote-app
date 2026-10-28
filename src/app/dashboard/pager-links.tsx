import Link from 'next/link'
import styles from './pager.module.css'

// The same pager for a list the server cuts into pages: each page is a link, so
// it works without scripts and the page is in the address. Nothing renders for a
// single page.
export function PagerLinks({
  page,
  pages,
  total,
  noun,
  hrefFor,
}: {
  page: number
  pages: number
  total: number
  noun: string
  hrefFor: (page: number) => string
}) {
  if (pages <= 1) return null
  return (
    <nav aria-label={`${noun} pages`} className={styles.pager}>
      <p>
        {total} {noun}
      </p>
      <div className={styles.controls}>
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="button button-soft">
            Previous
          </Link>
        ) : (
          <span
            className={`button button-soft ${styles.off}`}
            aria-disabled="true"
          >
            Previous
          </span>
        )}
        <span aria-current="page" className={styles.now}>
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className="button button-soft">
            Next
          </Link>
        ) : (
          <span
            className={`button button-soft ${styles.off}`}
            aria-disabled="true"
          >
            Next
          </span>
        )}
      </div>
    </nav>
  )
}
