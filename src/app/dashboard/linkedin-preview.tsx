'use client'

import { useState } from 'react'
import { isCut, profileName, splitHashtags } from '@/lib/linkedin-preview'
import { Icon } from './icons'
import styles from './linkedin-preview.module.css'

// How a post will look on LinkedIn: the profile line, the text cut after a few
// lines with "…more", hashtags in blue, and the row of actions. It is a close
// picture, not LinkedIn itself, and it says so.
//
// Everything is plain text. The post is split only to colour hashtags; nothing
// is turned into a link or markup, and the actions are drawn but do nothing, so
// the preview can never post or send anything.

const ACTIONS = [
  { icon: 'thumb', label: 'Like' },
  { icon: 'comment', label: 'Comment' },
  { icon: 'repost', label: 'Repost' },
  { icon: 'send', label: 'Send' },
] as const

export function LinkedinPreview({
  body,
  name,
  headline,
  when = 'Now',
}: {
  body: string
  // The LinkedIn channel's name, if known. Otherwise a plain stand-in.
  name?: string | null
  headline?: string | null
  // "Now", or the time the post goes out.
  when?: string
}) {
  const [open, setOpen] = useState(false)
  const text = body.replace(/\r\n?/g, '\n').trim()
  const profile = profileName(name)
  const cut = isCut(text)

  return (
    <figure className={styles.wrap}>
      <article className={styles.card} aria-label="LinkedIn post preview">
        <header className={styles.head}>
          <span className={styles.avatar} aria-hidden="true">
            {profile.initial ?? <Icon name="user" size={22} />}
          </span>
          <div className={styles.who}>
            <strong>{profile.label}</strong>
            <span>{headline?.trim() ? headline.trim() : 'Preview'}</span>
            <span className={styles.when}>
              {when} <span aria-hidden="true">·</span>{' '}
              <Icon name="globe" size={12} />
              <span className={styles.srOnly}>Visible to anyone</span>
            </span>
          </div>
        </header>

        {text === '' ? (
          <p className={styles.empty}>Nothing to preview yet.</p>
        ) : (
          <div className={styles.body}>
            <div
              className={`${styles.text} ${cut && !open ? styles.clamp : ''}`}
            >
              {splitHashtags(text).map((part, index) =>
                part.hashtag ? (
                  <span key={index} className={styles.hashtag}>
                    {part.text}
                  </span>
                ) : (
                  part.text
                ),
              )}
            </div>
            {cut ? (
              <button
                type="button"
                className={styles.more}
                aria-expanded={open}
                onClick={() => {
                  setOpen(!open)
                }}
              >
                {open ? 'Show less' : '…more'}
              </button>
            ) : null}
          </div>
        )}

        <div className={styles.actions} aria-hidden="true">
          {ACTIONS.map((action) => (
            <span key={action.label}>
              <Icon name={action.icon} size={18} />
              {action.label}
            </span>
          ))}
        </div>
      </article>
      <figcaption className={styles.note}>
        A close picture of how this may look on LinkedIn. LinkedIn can show it a
        little differently.
      </figcaption>
    </figure>
  )
}
