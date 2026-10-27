import type { ReactNode } from 'react'

// Simple stroke icons, decorative only (aria-hidden). One place, so the
// sidebar, tiles and rows share a style.
const paths = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  rocket: (
    <>
      <path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2" />
      <path d="M12 15 9 12a22 22 0 0 1 2-4c2-3.5 5.5-5 9-5 0 3.5-1.5 7-5 9a22 22 0 0 1-4 2z" />
      <circle cx="15.5" cy="8.5" r="1.2" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="3" width="11" height="14" rx="2" />
      <path d="M5 8H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8 13h8M8 17h6" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  book: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 3v18M13 8h3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  signout: (
    <>
      <path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
