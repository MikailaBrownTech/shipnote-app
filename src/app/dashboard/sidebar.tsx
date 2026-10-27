'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/auth/actions'
import { Icon, type IconName } from './icons'
import styles from './shell.module.css'

type Item = {
  href: string
  label: string
  icon: IconName
  active: (pathname: string) => boolean
}

const NEW_PROJECT = '/dashboard/projects/new'

// Only places that exist. Generate, Calendar and the like are not listed until
// they are built.
const items: Item[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: 'home',
    active: (pathname) =>
      pathname === '/dashboard' ||
      (pathname.startsWith('/dashboard/projects') && pathname !== NEW_PROJECT),
  },
  {
    href: NEW_PROJECT,
    label: 'New project',
    icon: 'plus',
    active: (pathname) => pathname === NEW_PROJECT,
  },
  {
    href: '/dashboard/account',
    label: 'Account',
    icon: 'user',
    active: (pathname) => pathname.startsWith('/dashboard/account'),
  },
]

// The frame itself. With no pathname nothing is highlighted, which is what the
// layout shows while the real path loads.
export function SidebarView({ pathname }: { pathname: string }) {
  return (
    <aside className={styles.sidebar}>
      <Link href="/" className={`wordmark ${styles.brand}`}>
        Shipnote
      </Link>

      <nav aria-label="Dashboard" className={styles.nav}>
        <ul>
          {items.map((item) => {
            const current = item.active(pathname)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles.navLink} ${current ? styles.navActive : ''}`}
                  aria-current={current ? 'page' : undefined}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className={styles.sidebarFoot}>
        <p className={`on-violet ${styles.earlyAccess}`}>
          <strong>Early access</strong>
          Shipnote is invite only while it is being built.
        </p>
        <form action={signOut}>
          <button type="submit" className={styles.navLink}>
            <Icon name="signout" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}

// Reads the URL, so the layout wraps it in <Suspense>. It shows no user data
// and does not read the session; every page still calls requireUser() itself.
export function Sidebar() {
  return <SidebarView pathname={usePathname()} />
}
