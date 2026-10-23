import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, Images, LayoutGrid, MapPin, Navigation, Search } from 'lucide-react'
import { AppShell, LoadingBlock } from '../components/Shell'
import { CourtArt } from '../components/CourtArt'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { PublicClubDetail, PublicClubListing } from '../types'
import { openingHoursLabel, peso } from '../types'
import { directionsUrl, mapEmbedUrl, placeLine } from '../lib/maps'

// Tags sized for easy reading; the shared .pill style is too small for these cards.
const tag = 'inline-flex items-center rounded-full px-3 py-1 text-body font-semibold'
const tagMuted = `${tag} bg-slate-100 text-slate-700`
const tagBrand = `${tag} bg-brand-50 text-brand-800`
const tagOk = `${tag} bg-green-100 text-green-900`
const tagWarn = `${tag} bg-amber-100 text-amber-900`

const textLink = 'inline-flex min-h-12 items-center gap-1 font-semibold text-brand-800 underline underline-offset-2'

/** Signed-in people keep their menu; visitors get a light top bar with log in and sign up. */
function Frame({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const body = <main className="app-content-rail safe-bottom mx-auto w-full px-4 py-5 space-y-5">{children}</main>
  if (user) return <AppShell role={user.role}>{body}</AppShell>
  return (
    <div className="app-shell app-shell-desktop">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="app-content-rail mx-auto w-full px-4 py-2 flex items-center justify-between gap-2">
          <Link to="/clubs" className="inline-flex min-h-12 items-center gap-2 text-subtitle font-extrabold text-slate-950">
            <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-brand-700 text-caption font-bold text-white">RP</span>
            Rally Point
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            <Link to="/login" className="inline-flex min-h-12 items-center rounded-xl px-3 font-semibold text-brand-800 hover:bg-brand-50">
              Log in
            </Link>
            <Link
              to="/login"
              state={{ mode: 'join' }}
              className="inline-flex min-h-12 items-center rounded-xl bg-brand-700 px-4 font-bold text-white hover:bg-brand-800"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>
      {body}
    </div>
  )
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

type PublicCourt = PublicClubDetail['venues'][number]['courts'][number]

/** A court's photos, swipeable when there are several; a sample drawing when there are none. */
function CourtPictures({ court }: { court: PublicCourt }) {
  const photos = court.photos ?? []
  if (photos.length === 0) {
    return <CourtArt seed={court.id} muted={!court.in_service} label="Sample" className="aspect-[16/10]" />
  }
  const several = photos.length > 1
  return (
    <div className={`relative ${court.in_service ? '' : 'grayscale opacity-70'}`}>
      <div
        className="flex aspect-[16/10] snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] focus-visible:outline focus-visible:outline-3 focus-visible:outline-brand-600"
        {...(several ? { role: 'region', tabIndex: 0, 'aria-label': `Photos of ${court.name}. Swipe or use the arrow keys to see more.` } : {})}
      >
        {photos.map((url, index) => (
          <img
            key={url}
            src={url}
            alt={several ? `${court.name}, photo ${index + 1} of ${photos.length}` : `Photo of ${court.name}`}
            className="h-full w-full shrink-0 snap-center object-cover"
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
      {several ? (
        <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-950/70 px-2 py-0.5 text-caption font-semibold text-white">
          <Images size={14} aria-hidden /> {photos.length} photos
        </span>
      ) : null}
    </div>
  )
}

export function ClubDirectory() {
  const { user } = useAuth()
  const [clubs, setClubs] = useState<PublicClubListing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')

  useEffect(() => {
    let cancelled = false
    api.listPublicClubs()
      .then((rows) => { if (!cancelled) setClubs(rows) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clubs') })
    return () => { cancelled = true }
  }, [])

  const cities = useMemo(
    () => [...new Set((clubs ?? []).flatMap((club) => club.cities))].sort(),
    [clubs],
  )
  const shown = (clubs ?? []).filter((club) => {
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || [club.name, club.address, ...club.cities].some((field) => field?.toLowerCase().includes(q))
    return matchesQuery && (!city || club.cities.includes(city))
  })

  return (
    <Frame>
      <section className="relative overflow-hidden rounded-3xl bg-brand-900 text-white" aria-labelledby="find-title">
        <div aria-hidden className="absolute inset-0 opacity-30"><CourtArt seed="hero" label={null} className="h-full" /></div>
        <div className="relative space-y-4 bg-gradient-to-t from-brand-900 via-brand-900/85 to-brand-900/40 p-5 sm:p-7">
          <div>
            <h1 id="find-title" className="text-heading-1 font-extrabold tracking-tight">Find a court</h1>
            <p className="mt-1 text-subtitle text-brand-50">
              Book pickleball courts at clubs near you. See prices, courts and directions before you go.
            </p>
          </div>
          <div>
            <label className="sr-only" htmlFor="club-search">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={20} aria-hidden />
              <input
                id="club-search"
                type="search"
                className="input"
                // Inline so the shared .input padding cannot cover the search icon.
                style={{ paddingLeft: '2.6rem' }}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Club name, area or city"
              />
            </div>
          </div>
        </div>
      </section>

      {cities.length > 1 ? (
        <div role="group" aria-label="City" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {['', ...cities].map((name) => {
            const active = city === name
            return (
              <button
                key={name || 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => setCity(name)}
                className={`inline-flex min-h-12 shrink-0 items-center rounded-full border-2 px-4 font-semibold whitespace-nowrap ${
                  active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-brand-600'
                }`}
              >
                {name || 'All cities'}
              </button>
            )
          })}
        </div>
      ) : null}

      {error ? <p role="alert" className="text-body text-red-700">{error}</p> : null}
      {!clubs && !error ? <LoadingBlock /> : null}
      {clubs ? (
        <p className="text-body font-semibold text-slate-700" aria-live="polite">
          {shown.length === 0 ? 'No clubs match. Try another name or city.' : `${plural(shown.length, 'club')} to book`}
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((club) => (
          <li key={club.slug}>
            <Link
              to={`/clubs/${club.slug}`}
              className="control-feedback card group flex h-full flex-col overflow-hidden hover:border-brand-500 hover:shadow-lg"
            >
              <span className="relative block">
                {club.cover_photo ? (
                  <img src={club.cover_photo} alt={`Photo of ${club.name}`} className="block aspect-[16/9] w-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <CourtArt seed={club.slug} className="aspect-[16/9]" />
                )}
                {club.min_rate != null ? (
                  <span className="absolute right-2 top-2 rounded-lg bg-white px-2 py-1 text-body font-bold text-slate-950 shadow">
                    From {peso(club.min_rate)}/hr
                  </span>
                ) : null}
              </span>
              <span className="flex flex-1 flex-col gap-1 p-4">
                <span className="block text-title font-bold text-slate-950">{club.name}</span>
                {club.cities.length ? (
                  <span className="flex items-center gap-1 text-body text-slate-600">
                    <MapPin size={16} className="shrink-0" aria-hidden /> {club.cities.join(' · ')}
                  </span>
                ) : null}
                <span className="flex flex-wrap gap-2 pt-1">
                  <span className={tagMuted}>{plural(club.venue_count, 'location')}</span>
                  <span className={tagMuted}>{plural(club.court_count, 'court')}</span>
                  {club.min_rate != null && club.min_member_rate != null && club.min_member_rate < club.min_rate ? (
                    <span className={tagBrand}>Members from {peso(club.min_member_rate)}</span>
                  ) : null}
                </span>
                {club.min_rate == null ? (
                  <span className="text-body text-slate-600">No courts open for booking yet</span>
                ) : null}
                <span className="mt-auto flex items-center justify-between pt-2 font-bold text-brand-800">
                  View courts <ChevronRight size={20} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {user ? null : (
        <section className="card p-5" aria-labelledby="how-title">
          <h2 id="how-title" className="text-title font-bold text-slate-950">How booking works</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ['Pick a club', 'Compare courts, prices and locations.'],
              ['Log in or sign up', 'A free account is all you need.'],
              ['Choose a court and time', 'Book at the club page, then play.'],
            ].map(([title, text], index) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-800">{index + 1}</span>
                <span>
                  <span className="block font-semibold text-slate-900">{title}</span>
                  <span className="block text-body text-slate-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-body text-slate-600">
            Already a club member? <Link to="/login" className="font-semibold text-brand-800 underline underline-offset-2">Log in</Link> to see your pass and bookings.
          </p>
        </section>
      )}
    </Frame>
  )
}

export function ClubDetailPage() {
  const { slug = '' } = useParams()
  const { user, joinClub } = useAuth()
  const nav = useNavigate()
  const [club, setClub] = useState<PublicClubDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busyVenue, setBusyVenue] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setClub(undefined)
    api.publicClubDetail(slug)
      .then((detail) => { if (!cancelled) setClub(detail) })
      .catch((e) => { if (!cancelled) { setClub(null); setError(e instanceof Error ? e.message : 'Could not load this club') } })
    return () => { cancelled = true }
  }, [slug])

  async function book(venueId: string) {
    if (!club) return
    if (!user) {
      nav('/login', { state: { returnTo: `/clubs/${club.slug}` } })
      return
    }
    setBusyVenue(venueId)
    setError(null)
    try {
      await joinClub(club.slug, { asPlayer: true })
      nav('/member/book', { state: { venueId } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a booking here')
    } finally {
      setBusyVenue(null)
    }
  }

  if (club === undefined) return <Frame><LoadingBlock /></Frame>
  if (club === null) {
    return (
      <Frame>
        <Link to="/clubs" className={textLink}><ChevronLeft size={20} aria-hidden /> All clubs</Link>
        <h1 className="text-heading-1 font-extrabold text-slate-950">This club is not taking bookings</h1>
        <p className="text-body text-slate-600">{error ?? 'Check the link, or pick another club from the list.'}</p>
      </Frame>
    )
  }

  const place = placeLine(club)
  const isPlatform = user?.role === 'superadmin'
  const courts = club.venues.flatMap((venue) => venue.courts)
  const openRates = courts.filter((court) => court.in_service).map((court) => court.hourly_rate)
  const fromRate = openRates.length ? Math.min(...openRates) : null
  // Same order as the club card: a location cover first, else a court's main photo.
  const heroPhoto = club.venues.map((venue) => venue.cover_photo).find(Boolean)
    ?? courts.map((court) => court.photos?.[0]).find(Boolean)
    ?? null

  return (
    <Frame>
      <Link to="/clubs" className={textLink}><ChevronLeft size={20} aria-hidden /> All clubs</Link>

      <header className="relative overflow-hidden rounded-3xl bg-slate-900 text-white">
        {heroPhoto ? (
          <img src={heroPhoto} alt={`Photo of ${club.name}`} className="block aspect-[16/9] max-h-72 w-full object-cover sm:aspect-[21/9]" decoding="async" />
        ) : (
          <>
            <CourtArt seed={club.slug} label={null} className="aspect-[16/9] max-h-72 w-full sm:aspect-[21/9]" />
            <span className="absolute right-3 top-3 rounded-md bg-slate-950/70 px-2 py-0.5 text-caption font-semibold">Sample image</span>
          </>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/60 to-transparent p-4 pt-12">
          <h1 className="text-heading-1 font-extrabold tracking-tight">{club.name}</h1>
          {place ? <p className="mt-1 flex items-center gap-1 text-body text-slate-100"><MapPin size={16} aria-hidden /> {place}</p> : null}
        </div>
      </header>

      <ul className="flex flex-wrap gap-2" aria-label="At a glance">
        <li className={tagMuted}>{plural(club.venues.length, 'location')}</li>
        <li className={tagMuted}>{plural(courts.length, 'court')}</li>
        {fromRate != null ? <li className={tagBrand}>From {peso(fromRate)}/hr</li> : null}
      </ul>

      <p className="rounded-2xl bg-brand-50 p-4 text-body text-brand-900">
        {user
          ? `Booking here adds you to ${club.name} as a player. Membership is optional; members pay the member rate where a court has one.`
          : 'Log in or create a free account to book. Membership is optional; members pay the member rate where a court has one.'}
      </p>
      {error ? <p role="alert" className="text-body text-red-700">{error}</p> : null}

      {club.venues.map((venue) => {
        const bookable = venue.courts.some((court) => court.in_service)
        const venuePlace = placeLine(venue)
        const directions = directionsUrl(venue)
        const mapUrl = mapEmbedUrl(venue)
        return (
          <section key={venue.id} className="card overflow-hidden" aria-labelledby={`venue-${venue.id}`}>
            {venue.cover_photo ? (
              <img src={venue.cover_photo} alt={`Cover photo of ${venue.name}`} className="block aspect-[16/9] max-h-64 w-full object-cover" loading="lazy" decoding="async" />
            ) : null}
            <div className="space-y-2 p-4">
              <h2 id={`venue-${venue.id}`} className="text-heading-3 font-bold text-slate-950">{venue.name}</h2>
              {venuePlace ? (
                <p className="text-body text-slate-700 flex items-start gap-1"><MapPin size={16} className="mt-1 shrink-0" aria-hidden /> {venuePlace}</p>
              ) : null}
              <p className="text-body text-slate-700 flex items-center gap-1"><Clock size={16} className="shrink-0" aria-hidden /> {openingHoursLabel(venue.open_hour, venue.close_hour)}</p>
              {directions ? (
                <a className={textLink} href={directions} target="_blank" rel="noopener noreferrer">
                  <Navigation size={18} aria-hidden /> Get directions
                </a>
              ) : null}
            </div>

            <div className="border-t border-slate-100 p-4 space-y-3">
              <h3 className="flex items-center gap-2 text-title font-bold text-slate-900">
                <LayoutGrid size={18} aria-hidden /> Courts <span className="font-normal text-slate-500">({venue.courts.length})</span>
              </h3>
              {venue.courts.length === 0 ? <p className="text-body text-slate-600">No courts listed yet.</p> : (
                <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {venue.courts.map((court) => {
                    const memberDeal = court.member_rate != null && court.member_rate < court.hourly_rate
                    return (
                      <li key={court.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <CourtPictures court={court} />
                        <div className="space-y-1 p-3">
                          <p className="font-bold text-slate-950">{court.name}</p>
                          {court.in_service ? (
                            <>
                              <p className="text-body text-slate-800"><span className="font-bold">{peso(court.hourly_rate)}</span>/hr</p>
                              {memberDeal ? <p className="text-body text-brand-800">Members {peso(court.member_rate!)}</p> : null}
                              <span className={`${tagOk} whitespace-nowrap`}>Available</span>
                            </>
                          ) : (
                            <span className={`${tagWarn} whitespace-nowrap`}>Out of service</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {isPlatform ? null : (
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={!bookable || busyVenue !== null}
                  aria-busy={busyVenue === venue.id}
                  onClick={() => void book(venue.id)}
                >
                  {busyVenue === venue.id ? 'Opening booking…' : bookable ? `Book a court at ${venue.name}` : 'No courts open for booking'}
                </button>
              )}
            </div>

            {mapUrl ? (
              <iframe
                title={`Map of ${venue.name}`}
                src={mapUrl}
                className="block h-52 w-full border-t border-slate-200"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
          </section>
        )
      })}
      {isPlatform ? <p className="text-body text-slate-600">Platform accounts can look but cannot book.</p> : null}
    </Frame>
  )
}
