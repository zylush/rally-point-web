import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Building2, ChevronLeft, ChevronRight, Clock, Images, MapPin, Navigation, RefreshCw, Search } from 'lucide-react'
import { PublicFrame as Frame } from '../components/PublicFrame'
import { CourtArt } from '../components/CourtArt'
import { Photo } from '../components/Photo'
import {
  ClubAboutCard,
  ClubAddonsCard,
  ClubCoachesCard,
  ClubGallery,
  ClubPaymentCard,
  ClubPoliciesCard,
} from '../components/ClubProfileSections'
import { LoadingShapes } from '../components/Skeleton'
import { stagger } from '../lib/motion'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type { PublicClubDetail, PublicClubListing, PublicClubProfile } from '../types'
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

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

function rateLine(regular: number | null, member: number | null) {
  if (regular == null) return 'No courts open for booking yet'
  const from = `From ${peso(regular)} per hour`
  return member != null && member < regular ? `${from} · Members from ${peso(member)}` : from
}

type PublicCourt = PublicClubDetail['venues'][number]['courts'][number]

function courtBookPath(clubSlug: string, venueId: string, courtId?: string) {
  const params = new URLSearchParams({ venue: venueId })
  if (courtId) params.set('court', courtId)
  return `/clubs/${clubSlug}/book?${params.toString()}`
}

/** A single browseable court card; clicking in-service courts goes straight into its booking environment. */
function CourtCard({
  clubSlug,
  venueId,
  court,
  canBook = true,
}: {
  clubSlug: string
  venueId: string
  court: PublicCourt
  canBook?: boolean
}) {
  const target = courtBookPath(clubSlug, venueId, court.id)
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-brand-400 hover:shadow-xs">
      <CourtPictures court={court} />
      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
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
        {court.in_service && canBook ? (
          <Link
            to={target}
            className="control-feedback mt-3 inline-flex min-h-11 items-center justify-between rounded-xl bg-brand-50 px-3 text-body font-semibold text-brand-800 hover:bg-brand-100"
          >
            <span>Book {court.name}</span>
            <ChevronRight size={16} aria-hidden />
          </Link>
        ) : null}
      </div>
    </li>
  )
}

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

export function ClubDirectory({ landing = false }: { landing?: boolean }) {
  const [clubs, setClubs] = useState<PublicClubListing[] | null>(null)
  const [featuredClub, setFeaturedClub] = useState<PublicClubDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const loadDirectory = useCallback(() => {
    setError(null)
    setReloadKey((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    const fetchClubs = api.listPublicClubs()
    const fetchFeatured =
      typeof api.publicClubDetail === 'function'
        ? api.publicClubDetail(DEFAULT_CLUB_SLUG).catch(() => null)
        : Promise.resolve(null)

    Promise.all([fetchClubs, fetchFeatured])
      .then(([rows, featured]) => {
        if (cancelled) return
        setClubs(rows)
        setFeaturedClub(featured && featured.slug === DEFAULT_CLUB_SLUG ? featured : null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clubs')
      })
    return () => { cancelled = true }
  }, [reloadKey])

  const cities = useMemo(
    () => [...new Set((clubs ?? []).flatMap((club) => club.cities))].sort(),
    [clubs],
  )
  // Prioritize Rally Point (DEFAULT_CLUB_SLUG) first, then alphabetical.
  const orderedClubs = useMemo(() => {
    if (!clubs) return []
    return clubs.slice().sort((a, b) => {
      if (a.slug === DEFAULT_CLUB_SLUG && b.slug !== DEFAULT_CLUB_SLUG) return -1
      if (b.slug === DEFAULT_CLUB_SLUG && a.slug !== DEFAULT_CLUB_SLUG) return 1
      return a.name.localeCompare(b.name)
    })
  }, [clubs])

  const shown = orderedClubs.filter((club) => {
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || [club.name, club.address, ...club.cities].some((field) => field?.toLowerCase().includes(q))
    return matchesQuery && (!city || club.cities.includes(city))
  })
  const showFeaturedCourts = Boolean(featuredClub && !query.trim() && !city)

  return (
    <Frame
      title={landing ? 'Welcome to bRineLy' : 'Find a court'}
      subtitle={landing ? 'Pick a court and book your play · brinely.info' : 'Pick a club or court to book'}
    >
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

      {error ? (
        <section role="alert" className="card border-red-200 bg-red-50 p-4 space-y-2">
          <p className="text-body font-semibold text-red-800">{error}</p>
          <p className="text-caption text-red-700">Check your connection and try again to load available courts.</p>
          <button type="button" onClick={loadDirectory} className="control-feedback inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-300 bg-white px-3 text-body font-semibold text-red-800">
            <RefreshCw size={16} aria-hidden /> Try again
          </button>
        </section>
      ) : null}

      {!clubs && !error ? <ClubCardsLoading /> : null}

      {/* Prioritized Rally Point Court Environment: clickable court cards immediately on arrival */}
      {showFeaturedCourts && featuredClub ? (
        <section className="enter-rise card border-brand-200 bg-gradient-to-b from-brand-50/70 to-white p-4 space-y-3" aria-labelledby="featured-rally-point-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-caption font-bold uppercase tracking-wider text-brand-800">Featured club · Primary court environment</p>
              <h2 id="featured-rally-point-heading" className="text-title font-extrabold text-slate-900">{featuredClub.name}</h2>
            </div>
            <Link to={`/clubs/${featuredClub.slug}`} className={textLink}>
              Full club profile <ChevronRight size={16} aria-hidden />
            </Link>
          </div>
          {featuredClub.venues.map((venue) => (
            <div key={venue.id} className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-body text-slate-600">
                <p className="font-semibold text-slate-800">{venue.name}</p>
                <p className="inline-flex items-center gap-1 text-caption">
                  <Clock size={14} aria-hidden /> {openingHoursLabel(venue.open_hour, venue.close_hour)}
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {venue.courts.map((court) => (
                  <CourtCard
                    key={court.id}
                    clubSlug={featuredClub.slug}
                    venueId={venue.id}
                    court={court}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

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

      <section className="card border-slate-200 bg-slate-50/80 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-800" aria-hidden>
            <Building2 size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-subtitle font-bold text-slate-900">Own a pickleball club?</p>
            <p className="text-body text-slate-600">List your courts on bRineLy and manage bookings online.</p>
          </div>
        </div>
        <Link to="/owners" className="control-feedback inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 border-slate-200 bg-white px-4 text-body font-semibold text-slate-800">
          I own a court <ChevronRight size={16} aria-hidden />
        </Link>
      </section>
    </Frame>
  )
}

export function ClubDetailPage() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const [club, setClub] = useState<PublicClubDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // The club's business profile is extra: the page still shows courts if it cannot load.
  const [profile, setProfile] = useState<{ slug: string; data: PublicClubProfile } | null>(null)

  useEffect(() => {
    let cancelled = false
    setClub(undefined)
    setError(null)
    api.publicClubDetail(slug)
      .then((detail) => { if (!cancelled) setClub(detail) })
      .catch((e) => { if (!cancelled) { setClub(null); setError(e instanceof Error ? e.message : 'Could not load this club') } })
    if (typeof api.publicClubProfile === 'function') {
      api.publicClubProfile(slug)
        .then((data) => { if (!cancelled) setProfile(data ? { slug, data } : null) })
        .catch(() => { if (!cancelled) setProfile(null) })
    }
    return () => { cancelled = true }
  }, [slug])

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
  // Only this club's profile: a slower answer for a previous club page is never shown here.
  const info = profile?.slug === slug ? profile.data : null
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
        Tap any available court to check times and pick your slot. You only need to sign in right before payment.
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
                  <CourtCard
                    key={court.id}
                    clubSlug={club.slug}
                    venueId={venue.id}
                    court={court}
                    canBook={!isPlatform}
                  />
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
                disabled={!bookable}
                onClick={() => nav(courtBookPath(club.slug, venue.id))}
              >
                {bookable ? `Book a court at ${venue.name}` : 'No courts open for booking'}
              </button>
            )}
          </section>
        )
      })}

      {info ? (
        <>
          <ClubAboutCard clubName={club.name} profile={info} index={club.venues.length + 1} />
          <ClubGallery clubName={club.name} profile={info} index={club.venues.length + 2} />
          <ClubAddonsCard profile={info} index={club.venues.length + 3} />
          <ClubCoachesCard profile={info} index={club.venues.length + 4} />
          <ClubPaymentCard clubName={club.name} profile={info} index={club.venues.length + 5} />
          <ClubPoliciesCard profile={info} index={club.venues.length + 6} />
        </>
      ) : null}
      {isPlatform ? <p className="text-body text-slate-600">Platform accounts can look but cannot book.</p> : null}
    </Frame>
  )
}
