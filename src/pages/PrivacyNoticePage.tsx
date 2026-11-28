import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { PhotoCredits } from '../components/PhotoCredits'
import { PublicFrame } from '../components/PublicFrame'
import { AppShell } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { PrivacyNoticeState } from '../lib/privacyNotice'
import {
  PRIVACY_NOTICE_UPDATED,
  corePrivacyNoticeSections,
  type NoticeClub,
  type PrivacyNoticeSection,
} from '../lib/privacyNoticeContent'
import { homeFor } from '../lib/roleHome'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'

function sections(club: NoticeClub): PrivacyNoticeSection[] {
  return [...corePrivacyNoticeSections(club), { title: 'Photo credits', content: <PhotoCredits /> }]
}

/** "Who we are" becomes "who-we-are"; the site footer links to `/privacy#photo-credits`. */
function sectionId(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The club this notice is for: the join link's club, the signed-in club, or the default club. */
function useNoticeClub(slug: string): NoticeClub {
  const { activeClub } = useAuth()
  const knownName = slug === activeClub?.slug ? activeClub.name : null
  const [lookedUp, setLookedUp] = useState<{ slug: string; name: string | null } | null>(null)

  useEffect(() => {
    if (slug === DEFAULT_CLUB_SLUG || knownName) return
    let cancelled = false
    api
      .publicClub(slug)
      .then((club) => {
        if (!cancelled) setLookedUp({ slug, name: club?.name ?? null })
      })
      .catch(() => {
        if (!cancelled) setLookedUp({ slug, name: null })
      })
    return () => {
      cancelled = true
    }
  }, [knownName, slug])

  return {
    isGensan: slug === DEFAULT_CLUB_SLUG,
    name: knownName ?? (lookedUp?.slug === slug ? lookedUp.name : null),
  }
}

/** Only same-app paths are followed, never another site. */
function safeReturnPath(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null
}

function backLabel(path: string) {
  if (path === '/login') return 'Back to login'
  if (path.startsWith('/join/')) return 'Back to sign-up'
  if (path.endsWith('/help')) return 'Back to Help'
  return 'Back'
}

export function PrivacyNoticePage() {
  const { user, activeClub } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const clubParam = params.get('club')
  const slug = clubParam ?? activeClub?.slug ?? DEFAULT_CLUB_SLUG
  const club = useNoticeClub(slug)

  const backTo =
    safeReturnPath((location.state as PrivacyNoticeState | null)?.from) ??
    (user ? homeFor(user.role) : clubParam ? `/join/${encodeURIComponent(clubParam)}` : '/login')

  const subtitle = club.isGensan
    ? 'For bRineLy booking portal users'
    : club.name
      ? `For ${club.name} players on the bRineLy booking portal`
      : 'For bRineLy booking portal users'

  const noticeSections = sections(club)
  // Set by a contents link, so the jump also moves keyboard focus to that section.
  const jumpedByLink = useRef(false)

  // HashRouter keeps the section in the router's location (`/privacy#photo-credits`), so the
  // browser cannot jump there itself. Scroll on arrival and after each contents link.
  useEffect(() => {
    let id = location.hash.replace(/^#/, '')
    try {
      id = decodeURIComponent(id)
    } catch {
      // A malformed address keeps its raw text, which matches no section.
    }
    // "Back to top" scrolls the whole page and puts focus back at the start of the notice.
    const toTop = id === 'top'
    const target = toTop ? document.documentElement : id ? document.getElementById(id) : null
    if (!target) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    if (jumpedByLink.current) {
      jumpedByLink.current = false
      const focusTarget = toTop ? document.getElementById('privacy-notice') : target.querySelector<HTMLElement>('h2')
      focusTarget?.focus({ preventScroll: true })
    }
  }, [location.hash, location.key])

  const backLink = (
    <Link className="text-link inline-flex min-h-12 items-center" to={backTo}>
      {backLabel(backTo)}
    </Link>
  )

  // A legal page: no marketing line here (the site footer carries it).
  const tagline = <p className="text-body text-muted">Last updated: {PRIVACY_NOTICE_UPDATED}</p>

  const backToTop = (
    <p className="mt-2 border-t border-line pt-4">
      <Link
        to={{ pathname: location.pathname, search: location.search, hash: '#top' }}
        state={location.state}
        replace
        onClick={() => {
          jumpedByLink.current = true
        }}
        className="text-link inline-flex min-h-12 items-center"
      >
        Back to top
      </Link>
    </p>
  )

  const body = (
    <>
      <nav aria-labelledby="privacy-contents" className="mt-4 border-y border-line py-4">
        <p id="privacy-contents" className="text-subtitle font-semibold text-ink">
          On this page
        </p>
        <ul className="mt-1 grid sm:grid-cols-2 sm:gap-x-6">
          {noticeSections.map(({ title }) => (
            <li key={title}>
              <Link
                to={{ pathname: location.pathname, search: location.search, hash: `#${sectionId(title)}` }}
                state={location.state}
                replace
                onClick={() => {
                  jumpedByLink.current = true
                }}
                className="text-link inline-flex min-h-12 items-center font-normal"
              >
                {title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="divide-y divide-line">
        {noticeSections.map(({ title, content: sectionBody }) => {
          const id = sectionId(title)
          return (
            <section key={title} id={id} aria-labelledby={`privacy-${id}`} className="scroll-mt-24 py-6">
              <h2 id={`privacy-${id}`} tabIndex={-1} className="text-heading-3 font-semibold text-ink focus:outline-none">
                {title}
              </h2>
              <div className="mt-2 text-subtitle leading-relaxed text-ink">{sectionBody}</div>
            </section>
          )
        })}
      </div>
      {backToTop}
    </>
  )

  // Visitors get the public site frame; signed-in players keep their menu.
  if (!user) {
    return (
      <PublicFrame title="Privacy Notice" subtitle={subtitle} width="narrow">
        <div id="privacy-notice" tabIndex={-1} className="max-w-[68ch] focus:outline-none">
          {tagline}
          <div className="mt-2">{backLink}</div>
          {body}
        </div>
      </PublicFrame>
    )
  }

  return (
    <AppShell role={user.role}>
      <main className="app-content-rail safe-bottom mx-auto w-full py-6 sm:py-10">
        <div id="privacy-notice" tabIndex={-1} className="mx-auto max-w-[68ch] focus:outline-none">
          {backLink}
          <header className="mt-4">
            <h1 className="text-heading-1 font-semibold text-ink">Privacy Notice</h1>
            <p className="mt-2 text-subtitle text-muted">{subtitle}</p>
            <div className="mt-1">{tagline}</div>
          </header>
          {body}
        </div>
      </main>
    </AppShell>
  )
}
