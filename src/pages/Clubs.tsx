import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { PublicFrame as Frame } from '../components/PublicFrame'
import { ClubCard, ClubCardsLoading } from '../components/ClubCard'
import { ClubImage } from '../components/ClubImage'
import { OwnersStrip } from '../components/OwnersStrip'
import { clubContactLinks, clubGrid, pesoKeep, plural, shortClubGrid } from '../lib/clubFormat'
import { CourtArt } from '../components/CourtArt'
import { ClubLeaderboardPreviewCard } from '../components/LeaderboardView'
import { ClubTournamentsPreviewCard } from '../components/TournamentView'
import { Photo } from '../components/Photo'
import {
  ClubAboutCard,
  ClubAddonsCard,
  ClubCoachesCard,
  ClubContactLinks,
  ClubGallery,
  ClubPaymentCard,
  ClubPoliciesCard,
} from '../components/ClubProfileSections'
import { LoadingShapes } from '../components/Skeleton'
import { stagger } from '../lib/motion'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type { ClubLeaderboardSnapshot, CourtType, PublicClubDetail, PublicClubListing, PublicClubProfile, TournamentSummary } from '../types'
import { courtTypeLabel, isCourtType, openingHoursLabel } from '../types'
import { directionsUrl, mapEmbedUrl, placeLine } from '../lib/maps'

const textLink = 'text-link inline-flex min-h-12 items-center gap-1 text-subtitle'
/** Public-page buttons fill the width on phones and size to their words from small tablets up. */
const fitButton = 'sm:w-auto! sm:px-6'

/** The club page's shape (photo, summary, one location with two courts) while it loads. */
function ClubDetailLoading() {
  return (
    <LoadingShapes label="Loading club…">
      <div className="space-y-4" aria-hidden>
        <div className="skeleton aspect-[16/9] max-h-80 w-full rounded-[12px]!" />
        <div className="skeleton h-5 w-3/5" />
        <div className="skeleton h-[54px] w-full rounded-[10px]! sm:w-48 lg:hidden" />
        <div className="card p-4 space-y-3">
          <div className="space-y-2">
            <div className="skeleton h-7 w-1/2" />
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-5 w-2/5" />
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1].map((key) => (
              <li key={key} className="overflow-hidden rounded-[10px] border border-line">
                <div className="skeleton aspect-[16/7] rounded-none!" />
                <div className="space-y-2 p-3">
                  <div className="skeleton h-6 w-3/4" />
                  <div className="skeleton h-5 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
          <div className="skeleton h-[54px] w-full rounded-[10px]!" />
        </div>
      </div>
    </LoadingShapes>
  )
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
    <li className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-white">
      <CourtPictures court={court} />
      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
          <p className="text-subtitle font-semibold text-ink">{court.name}</p>
          <CourtTypeLine type={court.court_type} />
          {/* Courts open for booking say so with their price and Book button; only a closed court gets a label. */}
          {court.in_service ? (
            <>
              <p className="text-subtitle font-normal text-muted">{pesoKeep(court.hourly_rate)} per hour</p>
              {court.member_rate != null && court.member_rate < court.hourly_rate ? (
                <p className="text-subtitle font-normal text-ink">Members {pesoKeep(court.member_rate)}</p>
              ) : null}
            </>
          ) : (
            <span className="pill pill-warn mt-2">Out of service</span>
          )}
        </div>
        {court.in_service && canBook ? (
          <Link
            to={target}
            aria-label={`Book ${court.name}`}
            className="btn-compact mt-3 w-full"
          >
            {/* The card already names the court, so the button just says Book. */}
            <span>Book</span>
            <ChevronRight size={18} className="shrink-0" aria-hidden />
          </Link>
        ) : null}
      </div>
    </li>
  )
}

/** "Indoor" or "Outdoor" under a court's name; nothing when the club has not set it. */
function CourtTypeLine({ type }: { type: CourtType | null | undefined }) {
  const label = courtTypeLabel(type)
  return label ? <p className="text-subtitle font-normal text-muted">{label}</p> : null
}

/** A court's photos, swipeable when there are several; a sample drawing when there are none. */
function CourtPictures({ court }: { court: PublicCourt }) {
  const photos = court.photos ?? []
  if (photos.length === 0) {
    // The drawing is a stand-in, so it stays shorter than a real photo.
    return <CourtArt seed={court.id} muted={!court.in_service} className="aspect-[16/7]" />
  }
  const several = photos.length > 1
  return (
    <div className={`relative ${court.in_service ? '' : 'grayscale opacity-70'}`}>
      <div
        className="flex aspect-[16/10] snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] focus-visible:outline focus-visible:outline-3 focus-visible:outline-brand-700"
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
      {several ? <span className="photo-label pointer-events-none">{photos.length} photos</span> : null}
    </div>
  )
}

/** Default club first, then alphabetical. */
function byDefaultThenName(a: PublicClubListing, b: PublicClubListing) {
  if (a.slug === DEFAULT_CLUB_SLUG && b.slug !== DEFAULT_CLUB_SLUG) return -1
  if (b.slug === DEFAULT_CLUB_SLUG && a.slug !== DEFAULT_CLUB_SLUG) return 1
  return a.name.localeCompare(b.name)
}

const COURT_TYPE_FILTERS: { value: '' | CourtType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
]

/** Whether a club has at least one in-service court of this type. */
function hasCourtType(club: PublicClubListing, type: CourtType) {
  return (type === 'indoor' ? club.indoor_courts : club.outdoor_courts) > 0
}

/**
 * Find a court: every club taking bookings, filtered by name, city or court type. The filters
 * live in the link (`?q=`, `?city=` and `?type=`), so a search from the landing page, a shared
 * link and the back button all show the same list.
 */
export function ClubDirectory() {
  const [clubs, setClubs] = useState<PublicClubListing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const city = searchParams.get('city') ?? ''
  const typeParam = searchParams.get('type')
  const courtType: '' | CourtType = isCourtType(typeParam) ? typeParam : ''

  const setFilter = useCallback((name: 'q' | 'city' | 'type', value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(name, value)
      else next.delete(name)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const clearFilters = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('q')
      next.delete('city')
      next.delete('type')
      return next
    }, { replace: true })
  }

  const loadDirectory = useCallback(() => {
    setError(null)
    setReloadKey((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    api.listPublicClubs()
      .then((rows) => { if (!cancelled) setClubs(rows) })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clubs')
      })
    return () => { cancelled = true }
  }, [reloadKey])

  const cities = useMemo(
    () => [...new Set((clubs ?? []).flatMap((club) => club.cities))].sort(),
    [clubs],
  )
  const orderedClubs = useMemo(() => (clubs ? clubs.slice().sort(byDefaultThenName) : []), [clubs])
  // The type choice appears once any club has said which of its courts are indoor or outdoor
  // (or a shared link already picked one, so it can be changed back).
  const showTypeFilter = Boolean(courtType) || (clubs ?? []).some((club) => club.indoor_courts > 0 || club.outdoor_courts > 0)

  const q = query.trim().toLowerCase()
  const filtering = Boolean(q || city || courtType)
  const shown = orderedClubs.filter((club) => {
    const matchesQuery = !q || [club.name, club.address, ...club.cities].some((field) => field?.toLowerCase().includes(q))
    return matchesQuery && (!city || club.cities.includes(city)) && (!courtType || hasCourtType(club, courtType))
  })
  // One or two clubs share their row with the owners tile instead of leaving a column empty.
  const short = shortClubGrid(shown.length)
  const clubItems = shown.map((club, index) => (
    <li key={club.slug} className="enter-rise" style={stagger(index)}>
      <ClubCard club={club} />
    </li>
  ))

  return (
    <Frame
      title="Find a court"
      subtitle="Pickleball clubs you can book online."
    >
      {/* The same columns as the club cards below, so the search lines up with them. */}
      <div role="search" aria-label="Search clubs" className={clubGrid}>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="club-search">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} aria-hidden />
            <input
              id="club-search"
              type="search"
              className="input input-with-icon"
              value={query}
              onChange={(event) => setFilter('q', event.target.value)}
              placeholder="Club name or city"
              autoComplete="off"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="club-city">City</label>
          <select id="club-city" className="input" value={city} onChange={(event) => setFilter('city', event.target.value)}>
            <option value="">All cities</option>
            {cities.map((name) => <option key={name} value={name}>{name}</option>)}
            {city && clubs && !cities.includes(city) ? <option value={city}>{city}</option> : null}
          </select>
        </div>
        {showTypeFilter ? (
          <div className="sm:col-span-2 lg:col-span-3" role="group" aria-labelledby="club-type-label">
            <p id="club-type-label" className="label">Indoor or outdoor</p>
            <div className="segmented">
              {COURT_TYPE_FILTERS.map((option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  aria-pressed={courtType === option.value}
                  onClick={() => setFilter('type', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <section role="alert" className="notice notice-error space-y-3">
          <div>
            <p className="text-body font-semibold">Could not load clubs</p>
            {error !== 'Could not load clubs' ? <p className="text-body">{error}</p> : null}
            <p className="text-body">Check your connection and try again.</p>
          </div>
          <button type="button" onClick={loadDirectory} className={`btn-secondary ${fitButton}`}>
            Try again
          </button>
        </section>
      ) : null}

      {!clubs && !error ? <ClubCardsLoading /> : null}

      {clubs ? (
        <div className="space-y-3">
          <p className="enter-rise text-subtitle font-normal text-muted" aria-live="polite">
            {shown.length > 0
              ? plural(shown.length, 'club')
              : filtering
                ? courtType
                  ? `No clubs with ${courtType} courts match. Try another name, city or court type.`
                  : 'No clubs match. Try another name or city.'
                : 'No clubs are taking bookings yet.'}
          </p>
          {shown.length === 0 && filtering ? (
            <button type="button" onClick={clearFilters} className={`btn-secondary ${fitButton}`}>
              Clear search
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Keyed by city and type so picking one replays the entrance; typing a search does not. */}
      {shown.length && short ? (
        <div key={`${city || 'all'}:${courtType || 'all'}`} className={clubGrid}>
          <ul className={short.list}>{clubItems}</ul>
          <OwnersStrip className={short.tile} />
        </div>
      ) : (
        <>
          {shown.length ? <ul key={`${city || 'all'}:${courtType || 'all'}`} className={clubGrid}>{clubItems}</ul> : null}
          <div className="pt-4">
            <OwnersStrip />
          </div>
        </>
      )}
    </Frame>
  )
}

/**
 * Today's hours, the price, the booking button and how to reach the club, beside the page on wide
 * screens. Phones already show the hours, price and button above, so there it keeps only the
 * contact links, and disappears when the club gave none.
 */
function ClubSideCard({
  club,
  fromRate,
  bookPath,
  info,
}: {
  club: PublicClubDetail
  fromRate: number | null
  bookPath: string | null
  info: PublicClubProfile | null
}) {
  const several = club.venues.length > 1
  const wideOnly = 'hidden lg:block'
  return (
    <aside aria-label="Booking summary" className="card p-5 space-y-4 lg:sticky lg:top-20">
      {club.venues.length ? (
        <div className={wideOnly}>
          <h2 className="text-subtitle font-semibold text-ink">Hours today</h2>
          <ul className="mt-1 space-y-0.5">
            {club.venues.map((venue) => (
              <li key={venue.id} className="text-subtitle text-muted">
                {several ? `${venue.name}: ` : ''}{openingHoursLabel(venue.open_hour, venue.close_hour)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {fromRate != null ? (
        <div className={wideOnly}>
          <h2 className="text-subtitle font-semibold text-ink">Price</h2>
          <p className="text-subtitle text-muted">From {pesoKeep(fromRate)} per hour</p>
        </div>
      ) : null}
      {bookPath ? (
        // Phones already have this button under the club's facts, just above this card.
        <Link to={bookPath} className="btn-primary hidden! lg:inline-flex!">Book a court</Link>
      ) : null}
      <p className={`${wideOnly} text-subtitle text-muted`}>You pay the club by GCash. Staff confirm your booking.</p>
      <ClubContactLinks profile={info} title="Contact" />
    </aside>
  )
}

export function ClubDetailPage() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const [club, setClub] = useState<PublicClubDetail | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // The club's business profile is extra: the page still shows courts if it cannot load.
  const [profile, setProfile] = useState<{ slug: string; data: PublicClubProfile } | null>(null)
  const [leaderboard, setLeaderboard] = useState<{ slug: string; data: ClubLeaderboardSnapshot } | null>(null)
  const [tournaments, setTournaments] = useState<{ slug: string; data: TournamentSummary[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setClub(undefined)
    setLoadError(null)
    api.publicClubDetail(slug)
      .then((detail) => { if (!cancelled) setClub(detail) })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error && e.message ? e.message : 'Check your connection and try again.')
      })
    if (typeof api.publicClubProfile === 'function') {
      api.publicClubProfile(slug)
        .then((data) => { if (!cancelled) setProfile(data ? { slug, data } : null) })
        .catch(() => { if (!cancelled) setProfile(null) })
    }
    if (typeof api.publicClubLeaderboard === 'function') {
      Promise.resolve(api.publicClubLeaderboard(slug, 'month', 'all', 5))
        .then((data) => { if (!cancelled) setLeaderboard(data ? { slug, data } : null) })
        .catch(() => { if (!cancelled) setLeaderboard(null) })
    }
    if (typeof api.listPublicClubTournaments === 'function') {
      Promise.resolve(api.listPublicClubTournaments(slug, 4))
        .then((data) => { if (!cancelled) setTournaments(data ? { slug, data } : null) })
        .catch(() => { if (!cancelled) setTournaments(null) })
    }
    return () => { cancelled = true }
  }, [slug, reloadKey])

  const back = <Link to="/clubs" className={`${textLink} -ml-1`}><ChevronLeft size={18} aria-hidden /> All clubs</Link>

  if (loadError) {
    return (
      <Frame title="We could not load this club" back={back}>
        <section role="alert" className="notice notice-error space-y-3">
          <p className="text-subtitle">{loadError}</p>
          <button type="button" onClick={() => setReloadKey((n) => n + 1)} className={`btn-secondary ${fitButton}`}>
            Try again
          </button>
        </section>
      </Frame>
    )
  }
  if (club === undefined) return <Frame title="Find a court" back={back}><ClubDetailLoading /></Frame>
  if (club === null) {
    return (
      <Frame title="This club is not taking bookings">
        <p className="text-subtitle text-muted">Check the link, or pick another club from the list.</p>
        <Link to="/clubs" className={`btn-secondary ${fitButton}`}>See all clubs</Link>
      </Frame>
    )
  }

  const isPlatform = user?.role === 'superadmin'
  // Club admins book as players (as on the booking page); only desk staff are turned away.
  const isClubStaff = user?.role === 'staff'
  const canBook = !isPlatform && !isClubStaff
  // Only this club's profile: a slower answer for a previous club page is never shown here.
  const info = profile?.slug === slug ? profile.data : null
  const courts = club.venues.flatMap((venue) => venue.courts)
  const hasCourts = courts.length > 0
  const openRates = courts.filter((court) => court.in_service).map((court) => court.hourly_rate)
  const fromRate = openRates.length ? Math.min(...openRates) : null
  const bookVenue = club.venues.find((venue) => venue.courts.some((court) => court.in_service))
  const bookPath = canBook && bookVenue ? courtBookPath(club.slug, bookVenue.id) : null
  // With several locations, each location card has its own directions link instead.
  const clubDirections = club.venues.length === 1 ? directionsUrl(club.venues[0]) : null
  // Location covers first, then court photos; ClubImage falls back to a labelled sample.
  const heroPhotos = [
    ...club.venues.map((venue) => venue.cover_photo),
    ...courts.flatMap((court) => court.photos ?? []),
  ]

  const cannotBookNotice = isClubStaff ? (
    <p className="notice text-subtitle" role="note">Staff accounts cannot book online. Log in with a player account to book.</p>
  ) : isPlatform ? (
    <p className="text-subtitle text-muted">Platform accounts can look but cannot book.</p>
  ) : null

  return (
    <Frame title={club.name} subtitle={placeLine(club) || undefined} back={back}>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-8">
        <div className="space-y-4 lg:col-start-1">
          <ClubImage
            photos={heroPhotos}
            seed={club.slug}
            alt={`Photo of ${club.name}`}
            kind="club"
            priority
            sizes="(min-width: 1024px) 66vw, 100vw"
            className="enter-rise block aspect-[16/9] max-h-80 w-full overflow-hidden rounded-[12px]"
          />

          <p className="text-subtitle font-normal text-muted">
            {plural(club.venues.length, 'location')} · {plural(courts.length, 'court')}
            {fromRate != null ? ` · From ${pesoKeep(fromRate)} per hour` : ''}
          </p>

          {hasCourts ? (
            <>
              {bookPath || clubDirections ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {bookPath ? <Link to={bookPath} className={`btn-primary ${fitButton} lg:hidden!`}>Book a court</Link> : null}
                  {clubDirections ? (
                    <a className={textLink} href={clubDirections} target="_blank" rel="noopener noreferrer">Get directions</a>
                  ) : null}
                </div>
              ) : null}
              {cannotBookNotice}
            </>
          ) : (
            <section className="notice space-y-3" aria-label="No courts listed">
              <p className="text-subtitle font-semibold">This club has not listed its courts yet.</p>
              <ClubContactLinks profile={info} />
              <Link to="/clubs" className={textLink}>Find another club</Link>
            </section>
          )}
        </div>

        {hasCourts ? (
          // On phones the card holds only the contact links, so it goes when there are none.
          <div className={`lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch ${clubContactLinks(info) ? '' : 'hidden lg:block'}`}>
            <ClubSideCard club={club} fromRate={fromRate} bookPath={bookPath} info={info} />
          </div>
        ) : null}

        <div className="space-y-4 lg:col-start-1">
          {club.venues.map((venue, venueIndex) => {
            const bookable = venue.courts.some((court) => court.in_service)
            const venuePlace = placeLine(venue)
            const directions = directionsUrl(venue)
            const mapUrl = mapEmbedUrl(venue)
            return (
              <section key={venue.id} className="enter-rise card p-4 space-y-3 sm:p-5" style={stagger(venueIndex + 1)} aria-labelledby={`venue-${venue.id}`}>
                {venue.cover_photo ? (
                  <Photo src={venue.cover_photo} alt={`Cover photo of ${venue.name}`} className="block aspect-[16/9] max-h-64 w-full rounded-[10px]" lazy />
                ) : null}
                <div>
                  <h2 id={`venue-${venue.id}`} className="text-heading-3 font-semibold text-ink">{venue.name}</h2>
                  {venuePlace ? <p className="text-subtitle font-normal text-muted">{venuePlace}</p> : null}
                  <p className="text-subtitle font-normal text-muted">{openingHoursLabel(venue.open_hour, venue.close_hour)}</p>
                  {directions ? (
                    <a className={textLink} href={directions} target="_blank" rel="noopener noreferrer">Get directions</a>
                  ) : null}
                </div>

                <h3 className="text-title font-semibold text-ink">Courts</h3>
                {venue.courts.length === 0 ? <p className="text-subtitle text-muted">No courts listed yet.</p> : (
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {venue.courts.map((court) => (
                      <CourtCard
                        key={court.id}
                        clubSlug={club.slug}
                        venueId={venue.id}
                        court={court}
                        canBook={canBook}
                      />
                    ))}
                  </ul>
                )}

                {mapUrl ? (
                  <iframe
                    title={`Map of ${venue.name}`}
                    src={mapUrl}
                    className="h-48 w-full rounded-[10px] border border-line"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : null}

                {canBook && venue.courts.length > 0 ? (
                  <button
                    type="button"
                    className={`btn-primary ${fitButton}`}
                    disabled={!bookable}
                    // Short on screen; the full name tells screen readers which location it books.
                    aria-label={bookable ? `Book a court here at ${venue.name}` : undefined}
                    onClick={() => nav(courtBookPath(club.slug, venue.id))}
                  >
                    {bookable ? 'Book a court here' : 'No courts open for booking'}
                  </button>
                ) : null}
              </section>
            )
          })}

          {info ? (
            <>
              <ClubAboutCard clubName={club.name} profile={info} index={club.venues.length + 1} />
              <ClubGallery clubName={club.name} profile={info} index={club.venues.length + 2} />
              <ClubAddonsCard profile={info} index={club.venues.length + 3} />
              <ClubCoachesCard clubSlug={club.slug} profile={info} index={club.venues.length + 4} />
              <ClubPaymentCard clubName={club.name} profile={info} index={club.venues.length + 5} />
              <ClubPoliciesCard profile={info} index={club.venues.length + 6} />
            </>
          ) : null}
          {typeof api.publicClubLeaderboard === 'function' ? (
            <ClubLeaderboardPreviewCard
              clubSlug={club.slug}
              clubName={club.name}
              snapshot={leaderboard?.slug === slug ? leaderboard.data : null}
              index={club.venues.length + (info ? 7 : 1)}
            />
          ) : null}
          {typeof api.listPublicClubTournaments === 'function' ? (
            <ClubTournamentsPreviewCard
              clubSlug={club.slug}
              clubName={club.name}
              tournaments={tournaments?.slug === slug ? tournaments.data : null}
              index={club.venues.length + (info ? 8 : 2)}
            />
          ) : null}
        </div>
      </div>
    </Frame>
  )
}
