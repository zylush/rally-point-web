import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BrinelyLogo } from './BrinelyLogo'
import { AppHeader, AppShell, SignOutButton } from './Shell'

/**
 * The frame for pages open to visitors (Find a court, the welcome page, the
 * court-owner page). Signed-in people get the usual app header and menu.
 * Visitors get the same header layout with Log in (and Sign up, unless the page
 * asks for Log in only), and no club logo: these pages are not one club's.
 */
export function PublicFrame({
  title,
  subtitle,
  accountLinks = 'both',
  children,
}: {
  title: string
  subtitle?: string
  accountLinks?: 'both' | 'login'
  children: ReactNode
}) {
  const { user } = useAuth()
  const body = <main className="safe-bottom px-4 pt-4 space-y-4">{children}</main>
  if (user) {
    return (
      <AppShell role={user.role}>
        <AppHeader title={title} subtitle={subtitle} right={<SignOutButton />} />
        {body}
      </AppShell>
    )
  }
  return (
    <div className="app-shell app-shell-desktop">
      <header className="sticky top-0 z-30 bg-white/98 backdrop-blur border-b border-slate-200 pt-4 pb-3.5">
        <div className="app-content-rail flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 inline-flex items-center gap-1.5 text-caption font-bold text-brand-800">
              <BrinelyLogo variant="mark" className="h-5 w-5 rounded-md object-contain" title="bRineLy" />
              <span>bRineLy</span>
              <span className="font-medium text-slate-500">· brinely.info</span>
            </p>
            <h1 className="text-heading-2 font-semibold text-slate-900">{title}</h1>
            {subtitle ? <p className="text-subtitle font-medium text-slate-600 mt-1">{subtitle}</p> : null}
          </div>
          <nav aria-label="Account" className="shrink-0 flex items-center gap-2">
            <Link
              to="/login"
              className="control-feedback min-h-12 px-3 rounded-2xl border-2 border-slate-200 inline-flex items-center text-body font-semibold text-slate-700"
            >
              Log in
            </Link>
            {accountLinks === 'both' ? (
              <Link
                to="/login"
                state={{ mode: 'join' }}
                className="control-feedback min-h-12 px-3 rounded-2xl bg-brand-700 inline-flex items-center text-body font-semibold text-white"
              >
                Sign up
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
      {body}
    </div>
  )
}
