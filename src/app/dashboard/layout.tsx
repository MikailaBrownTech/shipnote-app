import { Suspense } from 'react'
import { Sidebar, SidebarView } from './sidebar'
import styles from './shell.module.css'

// The frame around every dashboard page. It holds no user data and does no
// access control: each page calls requireUser() itself.
export default function DashboardLayout({
  children,
}: LayoutProps<'/dashboard'>) {
  return (
    <div className={styles.shell}>
      {/* usePathname() needs Suspense. The fallback is the same frame. */}
      <Suspense fallback={<SidebarView pathname="" />}>
        <Sidebar />
      </Suspense>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
