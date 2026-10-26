import type { Metadata } from 'next'
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/jetbrains-mono'
import { env } from '@/lib/env'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'Shipnote',
    template: '%s · Shipnote',
  },
  description:
    'Shipnote turns what you shipped this week into a LinkedIn post that sounds like you. You edit it and copy it. It never posts for you.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
