import { Link } from 'react-router-dom'
import { BrinelyLogo } from './BrinelyLogo'

type FooterLink = { label: string; to: string }

/*
 * Link names here stay different from the header's ("Log in", "Sign up") and from the
 * landing page's "I own a court", so each of those stays a single, unambiguous link.
 */
const groups: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Players',
    links: [
      { label: 'Find a court', to: '/clubs' },
      { label: 'Find a coach', to: '/coaches' },
      { label: 'All tournaments', to: '/tournaments' },
    ],
  },
  {
    title: 'Clubs',
    links: [
      { label: 'List your club', to: '/owners' },
      { label: 'Club staff sign-in', to: '/login' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Photo credits', to: '/privacy#photo-credits' },
    ],
  },
]

/**
 * The visitor footer: where to go next, who runs the site, and the photo credits. The dividing
 * lines sit inside the content rail, so they start and end where the content does.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer mt-auto border-t-0!">
      <div className="app-content-rail">
        {/* Three link columns even on a phone, so no group is left alone on a row. */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-8 border-t border-line py-10 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:gap-x-6">
          <div className="col-span-3 md:col-span-1">
            <p className="flex items-center gap-2">
              <BrinelyLogo variant="mark" className="h-7 w-7 object-contain" title="" />
              <BrinelyLogo variant="wordmark" className="h-6 w-auto object-contain" />
            </p>
            <p className="mt-1 text-subtitle font-semibold text-ink">Stay in the brine. Play more.</p>
            <p className="mt-2 max-w-xs text-subtitle">Court booking for pickleball clubs in the Philippines.</p>
          </div>
          {groups.map((group) => (
            <nav key={group.title} aria-label={group.title} className="min-w-0">
              <h2 className="text-body font-semibold text-ink">{group.title}</h2>
              <ul className="mt-1">
                {group.links.map((link) => (
                  <li key={link.to}>
                    {/* .text-link is bold; footer links stay regular weight. */}
                    <Link to={link.to} className="text-link inline-flex min-h-12 items-center font-normal!">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-t border-line py-5 text-body">© 2026 bRineLy · brinely.info</div>
      </div>
    </footer>
  )
}
