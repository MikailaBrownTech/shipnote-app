'use client'

import { useState } from 'react'
import { paginate } from '@/lib/posts'
import styles from './pager.module.css'

// Paging for a list that is already on the page. The list keeps every item in
// the page and only hides the ones that are not on the current page, so a draft
// being edited or a commit that is ticked is never lost by turning the page.

export function usePaged(total: number, size: number) {
  const [requested, setPage] = useState(1)
  // A page past the end (the list got shorter) is the last page.
  const { page, pages } = paginate(
    Array.from({ length: total }),
    requested,
    size,
  )
  return {
    page,
    pages,
    setPage,
    // Whether the item at this position is on the current page.
    visible: (index: number) =>
      index >= (page - 1) * size && index < page * size,
    // The items of the current page, for a list that only shows them.
    slice: <T,>(items: readonly T[]) =>
      items.slice((page - 1) * size, page * size),
  }
}

export function Pager({
  page,
  pages,
  total,
  noun,
  onPage,
}: {
  page: number
  pages: number
  total: number
  // What the list holds, plural: "drafts", "commits".
  noun: string
  onPage: (page: number) => void
}) {
  if (pages <= 1) return null
  return (
    <nav aria-label={`${noun} pages`} className={styles.pager}>
      <p>
        {total} {noun}
      </p>
      <div className={styles.controls}>
        <button
          type="button"
          className="button button-soft"
          disabled={page <= 1}
          onClick={() => {
            onPage(page - 1)
          }}
        >
          Previous
        </button>
        <span aria-current="page" className={styles.now}>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="button button-soft"
          disabled={page >= pages}
          onClick={() => {
            onPage(page + 1)
          }}
        >
          Next
        </button>
      </div>
    </nav>
  )
}
