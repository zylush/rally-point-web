import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrinelyLogo } from '../components/BrinelyLogo'
import { PublicFrame } from '../components/PublicFrame'
import { ClubCard, ClubCardsLoading } from '../components/ClubCard'
import { OwnersStrip } from '../components/OwnersStrip'
import { Photo } from '../components/Photo'
import { api } from '../lib/api'
import { clubGrid, shortClubGrid } from '../lib/clubFormat'
import { stagger } from '../lib/motion'
import { HERO_PHOTO, stockSrc, stockSrcSet } from '../lib/stockPhotos'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import { BOOKING_HOLD_MINUTES } from '../types'
import type { PublicClubListing } from '../types'

const TITLE = 'Book a pickleball court near you.'
const textLink = 'text-link inline-flex min-h-12 items-center text-subtitle'

const steps = [
  { title: 'Pick a club and a time', body: 'See free hours for today and the next 7 days.' },
  {
    title: 'Pay the club by GCash',
    body: `Scan the club's own QR code and type the reference. Your hours are held for ${BOOKING_HOLD_MINUTES} minutes.`,
  },
  { title: 'The club confirms', body: 'Staff check the payment, and your booking shows as Booked.' },
]

/** The default club first, then the rest by name. */
function byDefaultThenName(a: PublicClubListing, b: PublicClubListing) {
  if (a.slug === DEFAULT_CLUB_SLUG && b.slug !== DEFAULT_CLUB_SLUG) return -1
  if (b.slug === DEFAULT_CLUB_SLUG && a.slug !== DEFAULT_CLUB_SLUG) return 1
  return a.name.localeCompare(b.name)
}

/** The visitor's landing page: search for a court, how booking works, a few clubs, and a pointer for owners. */
export function WelcomePage() {
  return (
    <PublicFrame title={TITLE} heading="none">
      <Hero />
      <HowBookingWorks />
      <FeaturedClubs />
    </PublicFrame>
  )
}

function Hero() {
  const navigate = useNavigate()
  const searchId = useId()
  const [query, setQuery] = useState('')

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = query.trim()
    navigate(q ? `/clubs?q=${encodeURIComponent(q)}` : '/clubs')
  }

  return (
    // The text column is a little wider than the photo, so at 1024px "Book a pickleball" still fits
    // on one line beside the mark instead of breaking into three ragged lines.
    <section className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
      <div className="min-w-0 space-y-4">
        {/* The moving mark lives here only; the header keeps the still one so other pages stay calm.
            Mark and heading are one lockup: the mark is about one line of the heading tall and centred
            on its first line. Decorative (empty alt) and outside the h1, so the heading is what a screen
            reader meets first. */}
        <div className="flex items-start gap-3 lg:gap-4">
          <BrinelyLogo variant="animated" title="" className="h-10 w-auto shrink-0 lg:h-14" />
          <h1 className="min-w-0 text-display font-semibold text-ink lg:text-display-lg">{TITLE}</h1>
        </div>
        <p className="max-w-xl text-subtitle text-muted">
          See free hours at clubs across the Philippines, book by the hour, and pay the club by GCash.
        </p>
        <form role="search" onSubmit={search} className="max-w-xl space-y-2">
          <label className="label" htmlFor={searchId}>Search</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id={searchId}
              type="search"
              enterKeyHint="search"
              className="input sm:flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Club name or city"
            />
            <button type="submit" className="btn-primary sm:w-auto! sm:shrink-0 sm:px-6">
              Find a court
            </button>
          </div>
        </form>
        <Link to="/owners" className={textLink}>
          I own a court
        </Link>
      </div>
      <Photo
        src={stockSrc(HERO_PHOTO)}
        srcSet={stockSrcSet(HERO_PHOTO)}
        sizes="(min-width: 1024px) 50vw, 100vw"
        alt={HERO_PHOTO.alt}
        priority
        className="order-first aspect-[16/10] w-full rounded-[12px] lg:order-last"
      />
    </section>
  )
}

function HowBookingWorks() {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-4 pt-8">
      <h2 id={headingId} className="text-heading-2 font-semibold text-ink">How booking works</h2>
      <ol className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="card flex gap-4 p-5">
            <span className="text-heading-2 font-semibold text-brand-700" aria-hidden>
              {index + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-title font-semibold text-ink">{step.title}</h3>
              <p className="mt-1 text-body text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FeaturedClubs() {
  const headingId = useId()
  const [clubs, setClubs] = useState<PublicClubListing[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .listPublicClubs()
      .then((rows) => {
        if (!cancelled) setClubs(rows.slice().sort(byDefaultThenName).slice(0, 3))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const short = clubs ? shortClubGrid(clubs.length) : null
  const clubItems = (clubs ?? []).map((club, index) => (
    <li key={club.slug} className="enter-rise" style={stagger(index)}>
      <ClubCard club={club} />
    </li>
  ))

  function retry() {
    setFailed(false)
    setClubs(null)
    setAttempt((n) => n + 1)
  }

  return (
    <>
      <section aria-labelledby={headingId} className="space-y-4 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <h2 id={headingId} className="text-heading-2 font-semibold text-ink">Clubs on bRineLy</h2>
          <Link to="/clubs" className={textLink}>
            See all clubs
          </Link>
        </div>
        {failed ? (
          <div role="alert" className="notice notice-error flex flex-wrap items-center justify-between gap-3">
            <p className="text-body font-semibold">Could not load clubs</p>
            <button type="button" onClick={retry} className="btn-secondary sm:w-auto! sm:px-6">
              Try again
            </button>
          </div>
        ) : clubs === null ? (
          <ClubCardsLoading count={3} />
        ) : clubs.length === 0 ? (
          <p className="text-body text-muted">No clubs are listed yet.</p>
        ) : short ? (
          <div className={clubGrid}>
            <ul className={short.list}>{clubItems}</ul>
            <OwnersStrip className={short.tile} />
          </div>
        ) : (
          <ul className={clubGrid}>{clubItems}</ul>
        )}
      </section>
      {/* One or two clubs share their row with the owners tile; otherwise it closes the page. */}
      {short ? null : (
        <div className="pt-6">
          <OwnersStrip />
        </div>
      )}
    </>
  )
}
