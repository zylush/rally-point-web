import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { CourtSymbolsBackdrop } from './CourtSymbolsBackdrop'
import { AppHeader, AppShell, SignOutButton } from './Shell'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/**
 * The frame for pages open to visitors (the landing page, Find a court, club pages, the
 * court-owner page). Signed-in staff and admins get their usual app header and menu;
 * signed-in players and members stay on the public site, with the account menu in the header.
 *
 * Visitors get a plain site header (logo home, Find a court, For court owners, and Log in /
 * Sign up unless the page asks otherwise), the page heading at the top of the content, and the
 * site footer. `heading="none"` lets a page set its own h1, for example inside a photo hero.
 * `back` is an optional link back up (such as "All clubs"), shown above the page heading.
 */
export function PublicFrame({
  title,
  subtitle,
  accountLinks = 'both',
  heading = 'page',
  width = 'wide',
  back,
  children,
}: {
  title: string
  subtitle?: string
  accountLinks?: 'both' | 'login' | 'none'
  heading?: 'page' | 'none'
  width?: 'wide' | 'narrow'
  back?: ReactNode
  children: ReactNode
}) {
  const { user } = useAuth()
  // AppHeader names the tab too when someone is signed in; both use the same page title.
  useDocumentTitle(title)

  if (user && user.role !== 'member') {
    return (
      <AppShell role={user.role}>
        <AppHeader title={title} subtitle={subtitle} right={<SignOutButton />} />
        <main className="safe-bottom px-4 pt-4 space-y-4">
          {/* The app header holds the title, so the way back leads the content. */}
          {back ? <div>{back}</div> : null}
          {children}
        </main>
      </AppShell>
    )
  }

  return (
    <div className="app-shell app-shell-desktop app-shell-public flex flex-col">
      <CourtSymbolsBackdrop />
      <SiteHeader accountLinks={accountLinks} />
      <main className="app-content-rail flex-1 pt-6 pb-16">
        <div className={`space-y-4 ${width === 'narrow' ? 'max-w-[44rem]' : ''}`}>
          {heading === 'page' ? (
            <div className="pb-2">
              {back ? <div className="-mt-2 mb-1">{back}</div> : null}
              <h1 className="text-heading-1 font-semibold text-ink">{title}</h1>
              {subtitle ? <p className="mt-1 text-subtitle text-muted">{subtitle}</p> : null}
            </div>
          ) : back ? (
            <div>{back}</div>
          ) : null}
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
