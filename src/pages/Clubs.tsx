import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, ImageOff, Images, MapPin, Navigation, Search } from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { CourtArt } from '../components/CourtArt'
import { LoadingShapes } from '../components/Skeleton'
import { stagger } from '../lib/motion'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { PublicClubDetail, PublicClubListing } from '../types'
import { openingHoursLabel, peso } from '../types'
import { directionsUrl, mapEmbedUrl, placeLine } from '../lib/maps'

const textLink = 'control-feedback inline-flex min-h-12 items-center gap-1 text-body font-semibold text-brand-800'

const clubGrid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'

/** Card-shaped placeholders in the same grid as the club list, so nothing jumps when clubs arrive. */
function ClubCardsLoading() {
  return (
    <LoadingShapes label="Loading clubs…">
      <div className="skeleton h-6 w-24" aria-hidden />
      <ul className={clubGrid} aria-hidden>
        {[0, 1, 2].map((key) => (
          <li key={key} className="card overflow-hidden">
            <div className="skeleton aspect-[16/9] rounded-none!" />
            <div className="space-y-2 p-4">
              <div className="skeleton h-6 w-3/4" />
              <div className="skeleton h-5 w-1/2" />
              <div className="skeleton h-5 w-2/3" />
              <div className="skeleton h-5 w-3/5" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingShapes>
  )
}

/** The club page's shape (photo, summary, one location with two courts) while it loads. */
function ClubDetailLoading() {
  return (
    <LoadingShapes label="Loading club…">
      <div className="space-y-4" aria-hidden>
        <div className="skeleton aspect-[16/9] max-h-72 w-full rounded-[18px]!" />
        <div className="skeleton h-5 w-3/5" />
        <div className="skeleton h-5 w-full" />
        <div className="card p-4 space-y-3">
          <div className="space-y-2">
            <div className="skeleton h-7 w-1/2" />
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-5 w-2/5" />
          </div>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {[0, 1].map((key) => (
              <li key={key} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="skeleton aspect-[16/10] rounded-none!" />
                <div className="space-y-2 p-3">
                  <div className="skeleton h-6 w-3/4" />
                  <div className="skeleton h-5 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
          <div className="skeleton h-[48px] w-full rounded-[16px]!" />
        </div>
      </div>
    </LoadingShapes>
  )
}

type PhotoState = 'loading' | 'loaded' | 'error'

/**
 * A photo that waits on a grey placeholder while it downloads, then fades in.
 * `className` sizes the frame (aspect, height, rounding), so the space is held either way.
 * A photo that fails to load leaves the labelled placeholder, never a broken-image icon.
 */
function Photo({ src, alt, className = '', lazy = false }: { src: string; alt: string; className?: string; lazy?: boolean }) {
  const [status, setStatus] = useState<{ src: string; state: PhotoState }>({ src, state: 'loading' })
  const state = status.src === src ? status.state : 'loading'
  // A cached photo can finish before React sees its load event; catch that on mount.
  // Errors come only from the error event: jsdom and not-yet-started lazy images also
  // report complete with no size, so that alone does not mean the photo is broken.
  const checkLoaded = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setStatus({ src, state: 'loaded' })
  }, [src])

  if (state === 'error') {
    return (
      <div role="img" aria-label={alt} data-state="error" className={`photo relative ${className}`}>
        <ImageOff size={28} className="absolute inset-0 m-auto text-slate-500" aria-hidden />
      </div>
    )
  }
  return (
    <div data-state={state} className={`photo relative overflow-hidden ${className}`}>
      <img
        ref={checkLoaded}
        src={src}
        alt={alt}
        className="photo-img absolute inset-0 h-full w-full object-cover"
        loading={lazy ? 'lazy' : undefined}
        decoding="async"
        onLoad={() => setStatus({ src, state: 'loaded' })}
        onError={() => setStatus({ src, state: 'error' })}
      />
    </div>
  )
}

/**
 * Signed-in people get the usual app header and menu. Visitors get the same
 * header layout with Log in and Sign up, and no club logo (this page is not one club's).
 */
function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
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
            <p className="text-caption font-bold text-brand-800 mb-1">Rally Point</p>
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
            <Link
              to="/login"
              state={{ mode: 'join' }}
              className="control-feedback min-h-12 px-3 rounded-2xl bg-brand-700 inline-flex items-center text-body font-semibold text-white"
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

function rateLine(regular: number | null, member: number | null) {
  if (regular == null) return 'No courts open for booking yet'
  const from = `From ${peso(regular)} per hour`
  return member != null && member < regular ? `${from} · Members from ${peso(member)}` : from
}

type PublicCourt = PublicClubDetail['venues'][number]['courts'][number]

/** A court's photos, swipeable when there are several; a sample drawing when there are none. */
function CourtPictures({ court }: { court: PublicCourt }) {
  const photos = court.photos ?? []
  if (photos.length === 0) {
    return <CourtArt seed={court.id} muted={!court.in_service} className="aspect-[16/10]" />
  }
  const several = photos.length > 1
  return (
    <div className={`relative ${court.in_service ? '' : 'grayscale opacity-70'}`}>
      <div
        className="flex aspect-[16/10] snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] focus-visible:outline focus-visible:outline-3 focus-visible:outline-brand-600"
        {...(several ? { role: 'region', tabIndex: 0, 'aria-label': `Photos of ${court.name}. Swipe or use the arrow keys to see more.` } : {})}
      >
        {photos.map((url, index) => (
          <Photo
            key={url}
            src={url}
            alt={several ? `${court.name}, photo ${index + 1} of ${photos.length}` : `Photo of ${court.name}`}
            className="h-full w-full shrink-0 snap-center"
            lazy
          />
        ))}
      </div>
      {several ? (
        <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-2 py-0.5 text-caption font-semibold text-white">
          <Images size={14} aria-hidden /> {photos.length} photos
        </span>
      ) : null}
    </div>
  )
}

export function ClubDirectory() {
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
    <Frame title="Find a court" subtitle="Pick a club to see its courts and book">
      <section className="enter-rise card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Search clubs">
        <div>
          <label className="label" htmlFor="club-search">Search</label>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
            <input
              id="club-search"
              className="input input-with-icon"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Club name or area"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="club-city">City</label>
          <select id="club-city" className="input" value={city} onChange={(event) => setCity(event.target.value)}>
            <option value="">All cities</option>
            {cities.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </section>

      {error ? <p role="alert" className="text-body text-red-700">{error}</p> : null}
      {!clubs && !error ? <ClubCardsLoading /> : null}
      {clubs ? (
        <p className="enter-rise text-body font-normal text-slate-600" aria-live="polite">
          {shown.length === 0 ? 'No clubs match. Try another name or city.' : plural(shown.length, 'club')}
        </p>
      ) : null}

      {/* Keyed by city so picking a city replays the entrance; typing a search does not. */}
      <ul key={city || 'all'} className={clubGrid}>
        {shown.map((club, index) => (
          <li key={club.slug} className="enter-rise" style={stagger(index)}>
            <Link to={`/clubs/${club.slug}`} className="control-feedback club-card card flex h-full flex-col overflow-hidden">
              {club.cover_photo ? (
                <Photo src={club.cover_photo} alt={`Photo of ${club.name}`} className="club-card-media block aspect-[16/9] w-full" lazy />
              ) : (
                <CourtArt seed={club.slug} className="club-card-media aspect-[16/9]" />
              )}
              <span className="flex flex-1 items-center gap-3 p-4">
                <span className="flex-1 min-w-0">
                  <span className="block text-subtitle font-semibold text-slate-900">{club.name}</span>
                  {club.cities.length ? (
                    <span className="block text-body font-normal text-slate-600">{club.cities.join(' · ')}</span>
                  ) : null}
                  <span className="block text-body font-normal text-slate-600">
                    {plural(club.venue_count, 'location')} · {plural(club.court_count, 'court')}
                  </span>
                  <span className="block text-body font-semibold text-brand-800">{rateLine(club.min_rate, club.min_member_rate)}</span>
                </span>
                <ChevronRight className="text-slate-400 shrink-0" size={22} aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
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

  const back = <Link to="/clubs" className={textLink}><ChevronLeft size={18} aria-hidden /> All clubs</Link>

  if (club === undefined) return <Frame title="Find a court">{back}<ClubDetailLoading /></Frame>
  if (club === null) {
    return (
      <Frame title="This club is not taking bookings">
        {back}
        <p className="text-body text-slate-600">{error ?? 'Check the link, or pick another club from the list.'}</p>
      </Frame>
    )
  }

  const isPlatform = user?.role === 'superadmin'
  const courts = club.venues.flatMap((venue) => venue.courts)
  const openRates = courts.filter((court) => court.in_service).map((court) => court.hourly_rate)
  const fromRate = openRates.length ? Math.min(...openRates) : null
  // Same order as the club card: a location cover first, else a court's main photo.
  const heroPhoto = club.venues.map((venue) => venue.cover_photo).find(Boolean)
    ?? courts.map((court) => court.photos?.[0]).find(Boolean)
    ?? null

  return (
    <Frame title={club.name} subtitle={placeLine(club) || undefined}>
      {back}

      {heroPhoto ? (
        <Photo src={heroPhoto} alt={`Photo of ${club.name}`} className="enter-rise block aspect-[16/9] max-h-72 w-full rounded-[18px]" />
      ) : (
        <CourtArt seed={club.slug} className="enter-rise aspect-[16/9] max-h-72 w-full rounded-[18px]" />
      )}

      <p className="text-body font-normal text-slate-600">
        {plural(club.venues.length, 'location')} · {plural(courts.length, 'court')}
        {fromRate != null ? ` · From ${peso(fromRate)} per hour` : ''}
      </p>
      <p className="text-body font-normal text-slate-600">
        {user
          ? `Booking here adds you to ${club.name} as a player. Membership is optional; members pay the member rate where a court has one.`
          : 'Log in or create a free account to book. Membership is optional; members pay the member rate where a court has one.'}
      </p>
      {error ? <p role="alert" className="text-body text-red-700">{error}</p> : null}

      {club.venues.map((venue, venueIndex) => {
        const bookable = venue.courts.some((court) => court.in_service)
        const venuePlace = placeLine(venue)
        const directions = directionsUrl(venue)
        const mapUrl = mapEmbedUrl(venue)
        return (
          <section key={venue.id} className="enter-rise card p-4 space-y-3" style={stagger(venueIndex + 1)} aria-labelledby={`venue-${venue.id}`}>
            {venue.cover_photo ? (
              <Photo src={venue.cover_photo} alt={`Cover photo of ${venue.name}`} className="block aspect-[16/9] max-h-64 w-full rounded-xl" lazy />
            ) : null}
            <div>
              <h2 id={`venue-${venue.id}`} className="text-title font-semibold text-slate-900">{venue.name}</h2>
              {venuePlace ? (
                <p className="text-body font-normal text-slate-600 flex items-start gap-1.5"><MapPin size={16} className="mt-[3px] shrink-0" aria-hidden /> {venuePlace}</p>
              ) : null}
              <p className="text-body font-normal text-slate-600 flex items-center gap-1.5"><Clock size={16} className="shrink-0" aria-hidden /> {openingHoursLabel(venue.open_hour, venue.close_hour)}</p>
              {directions ? (
                <a className={textLink} href={directions} target="_blank" rel="noopener noreferrer">
                  <Navigation size={16} aria-hidden /> Get directions
                </a>
              ) : null}
            </div>

            <h3 className="text-subtitle font-semibold text-slate-900">Courts</h3>
            {venue.courts.length === 0 ? <p className="text-body text-slate-600">No courts listed yet.</p> : (
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {venue.courts.map((court) => (
                  <li key={court.id} className="overflow-hidden rounded-xl border border-slate-200">
                    <CourtPictures court={court} />
                    <div className="p-3">
                      <p className="text-subtitle font-semibold text-slate-900">{court.name}</p>
                      {court.in_service ? (
                        <>
                          <p className="text-body font-normal text-slate-600">{peso(court.hourly_rate)} per hour</p>
                          {court.member_rate != null && court.member_rate < court.hourly_rate ? (
                            <p className="text-body font-normal text-brand-800">Members {peso(court.member_rate)}</p>
                          ) : null}
                          <span className="pill pill-ok mt-2">Available</span>
                        </>
                      ) : (
                        <span className="pill pill-warn mt-2">Out of service</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {mapUrl ? (
              <iframe
                title={`Map of ${venue.name}`}
                src={mapUrl}
                className="w-full h-48 rounded-xl border border-slate-200"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}

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
          </section>
        )
      })}
      {isPlatform ? <p className="text-body text-slate-600">Platform accounts can look but cannot book.</p> : null}
    </Frame>
  )
}
