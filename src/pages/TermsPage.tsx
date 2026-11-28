import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PublicFrame } from '../components/PublicFrame'
import { AppShell } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roleHome'
import { TERMS_UPDATED, termsSections } from '../lib/termsContent'

const SUBTITLE = 'For bRineLy booking portal users'

/** "How a booking works" becomes "how-a-booking-works", so `/terms#how-a-booking-works` jumps there. */
function sectionId(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function backLabel(path: string) {
  if (path === '/') return 'Back to home'
  if (path === '/clubs') return 'Back to Find a court'
  return 'Back'
}

export function TermsPage() {
  const { user } = useAuth()
  const location = useLocation()

  const backTo = user ? homeFor(user.role) : '/'
  const sections = termsSections()
  // Set by a contents link, so the jump also moves keyboard focus to that section.
  const jumpedByLink = useRef(false)

  // HashRouter keeps the section in the router's location (`/terms#contact`), so the
  // browser cannot jump there itself. Scroll on arrival and after each contents link.
  useEffect(() => {
    let id = location.hash.replace(/^#/, '')
    try {
      id = decodeURIComponent(id)
    } catch {
      // A malformed address keeps its raw text, which matches no section.
    }
    // "Back to top" scrolls the whole page and puts focus back at the start of the terms.
    const toTop = id === 'top'
    const target = toTop ? document.documentElement : id ? document.getElementById(id) : null
    if (!target) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    if (jumpedByLink.current) {
      jumpedByLink.current = false
      const focusTarget = toTop ? document.getElementById('terms-of-use') : target.querySelector<HTMLElement>('h2')
      focusTarget?.focus({ preventScroll: true })
    }
  }, [location.hash, location.key])

  const backLink = (
    <Link className="text-link inline-flex min-h-12 items-center" to={backTo}>
      {backLabel(backTo)}
    </Link>
  )

  // A legal page: no marketing line here (the site footer carries it).
  const tagline = <p className="text-body text-muted">Last updated: {TERMS_UPDATED}</p>

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
      <nav aria-labelledby="terms-contents" className="mt-4 border-y border-line py-4">
        <p id="terms-contents" className="text-subtitle font-semibold text-ink">
          On this page
        </p>
        <ul className="mt-1 grid sm:grid-cols-2 sm:gap-x-6">
          {sections.map(({ title }) => (
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
        {sections.map(({ title, content: sectionBody }) => {
          const id = sectionId(title)
          return (
            <section key={title} id={id} aria-labelledby={`terms-${id}`} className="scroll-mt-24 py-6">
              <h2 id={`terms-${id}`} tabIndex={-1} className="text-heading-3 font-semibold text-ink focus:outline-none">
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

  // Visitors get the public site frame; signed-in people keep their menu.
  if (!user) {
    return (
      <PublicFrame title="Terms of use" subtitle={SUBTITLE} width="narrow">
        <div id="terms-of-use" tabIndex={-1} className="max-w-[68ch] focus:outline-none">
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
        <div id="terms-of-use" tabIndex={-1} className="mx-auto max-w-[68ch] focus:outline-none">
          {backLink}
          <header className="mt-4">
            <h1 className="text-heading-1 font-semibold text-ink">Terms of use</h1>
            <p className="mt-2 text-subtitle text-muted">{SUBTITLE}</p>
            <div className="mt-1">{tagline}</div>
          </header>
          {body}
        </div>
      </main>
    </AppShell>
  )
}
