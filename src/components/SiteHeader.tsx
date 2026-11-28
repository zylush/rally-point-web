import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AccountMenu } from './AccountMenu'
import { BrinelyLogo } from './BrinelyLogo'

const mainLinks = [
  { to: '/clubs', label: 'Find a court' },
  { to: '/coaches', label: 'Rent a coach' },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/owners', label: 'For court owners' },
]

/**
 * The public site header: logo home, Find a court, Rent a coach, Tournaments, For court owners, and on the right either
 * Log in / Sign up (visitors) or the account menu (signed-in players and members).
 * Log in and Sign up remember this page, so signing in comes straight back to it.
 */
export function SiteHeader({ accountLinks = 'both' }: { accountLinks?: 'both' | 'login' | 'none' }) {
  const { user } = useAuth()
  const location = useLocation()
  const from = `${location.pathname}${location.search}`

  return (
    <header className="site-header md:sticky md:top-0 z-30">
      <div className="app-content-rail flex flex-wrap items-center justify-between gap-x-4 py-2">
        <Link
          to="/"
          aria-label="bRineLy home"
          className="control-feedback -ml-1 inline-flex min-h-12 items-center gap-2 rounded-[10px] px-1 text-title font-semibold text-ink"
        >
          <BrinelyLogo variant="mark" className="h-8 w-8 object-contain" title="" />
          {/* The drawn wordmark, not retyped text: the italic lettering is the most recognisable part of the brand. */}
          <BrinelyLogo variant="wordmark" className="h-6 w-auto object-contain" title="" />
        </Link>
        <nav
          aria-label="Main"
          className="order-last -mx-3 flex w-[calc(100%+1.5rem)] items-center overflow-x-auto border-t border-line md:order-none md:mx-0 md:mr-auto md:w-auto md:border-0"
        >
          {mainLinks.map((link) => (
            <NavLink key={link.to} to={link.to} className="site-nav-link shrink-0">
              {link.label}
            </NavLink>
          ))}
        </nav>
        {user?.role === 'member' ? (
          <AccountMenu />
        ) : user || accountLinks === 'none' ? null : (
          <nav aria-label="Account" className="flex items-center gap-1">
            <Link to="/login" state={{ from }} className="site-nav-link">
              Log in
            </Link>
            {accountLinks === 'both' ? (
              <Link
                to="/login"
                state={{ mode: 'join', from }}
                // Outlined, so the page's own main button stays the one filled button in view.
                className="control-feedback inline-flex min-h-12 items-center rounded-[10px] border-[1.5px] border-field bg-white px-4 font-semibold text-ink"
              >
                Sign up
              </Link>
            ) : null}
          </nav>
        )}
      </div>
    </header>
  )
}
