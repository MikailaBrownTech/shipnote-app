import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from './icons'
import shell from './shell.module.css'

// The top of a dashboard page: an optional back pill, a title whose last word
// is in the accent colour, and a subtitle. `accent` is off for titles that are
// the user's own text (a project name), which stay plain.
export function PageIntro({
  title,
  subtitle,
  backHref,
  backLabel = 'Back to dashboard',
  accent = true,
  children,
}: {
  title: string
  subtitle?: ReactNode
  backHref?: string
  backLabel?: string
  accent?: boolean
  children?: ReactNode
}) {
  const words = title.split(' ')
  const last = words.pop() ?? ''
  const rest = words.join(' ')

  return (
    <header className={shell.intro}>
      {backHref ? (
        <Link href={backHref} className={shell.back}>
          <Icon name="arrowLeft" size={16} />
          {backLabel}
        </Link>
      ) : null}
      <div className={shell.introRow}>
        <div className={shell.introText}>
          <h1>
            {accent ? (
              <>
                {rest}
                {rest ? ' ' : ''}
                <span className={shell.accent}>{last}</span>
              </>
            ) : (
              title
            )}
          </h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </header>
  )
}
