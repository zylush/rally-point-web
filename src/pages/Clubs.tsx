import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, MapPin, Search } from 'lucide-react'
import { AppShell, LoadingBlock } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { PublicClubDetail, PublicClubListing } from '../types'
import { hourLabel, peso } from '../types'

/** Signed-in people keep their menu; visitors see the page on its own with a way to log in. */
function Frame({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const body = <main className="app-content-rail safe-bottom mx-auto w-full px-4 py-6 space-y-4">{children}</main>
  if (user) return <AppShell role={user.role}>{body}</AppShell>
  return (
    <div className="app-shell app-shell-desktop">
      <div className="app-content-rail mx-auto w-full px-4 pt-4 flex items-center justify-between gap-3">
        <span className="text-subtitle font-extrabold text-brand-800">Rally Point</span>
        <Link to="/login" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2">
          Log in
        </Link>
      </div>
      {body}
    </div>
  )
}

function rateLine(regular: number | null, member: number | null) {
  if (regular == null) return 'No courts open for booking yet'
  const from = `From ${peso(regular)} per hour`
  return member != null && member < regular ? `${from} · Members from ${peso(member)}` : from
}

function placeLine(address: string | null, city: string | null) {
  return [address, city].filter((value, index, all) => value && all.indexOf(value) === index).join(', ')
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
    () => [...new Set((clubs ?? []).map((club) => club.city).filter((c): c is string => !!c))].sort(),
    [clubs],
  )
  const shown = (clubs ?? []).filter((club) => {
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || [club.name, club.city, club.address].some((field) => field?.toLowerCase().includes(q))
    return matchesQuery && (!city || club.city === city)
  })

  return (
    <Frame>
      <header>
        <h1 className="text-heading-1 font-extrabold tracking-tight text-slate-950">Find a court</h1>
        <p className="mt-1 text-body text-slate-600">Pickleball clubs on Rally Point. Pick a club to see its courts and book.</p>
      </header>

      <section className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Search clubs">
        <div>
          <label className="label" htmlFor="club-search">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
            <input
              id="club-search"
              className="input"
              // Inline so the shared .input padding cannot cover the search icon.
              style={{ paddingLeft: '2.5rem' }}
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
      {!clubs && !error ? <LoadingBlock /> : null}
      {clubs && shown.length === 0 ? (
        <p className="text-body text-slate-600">No clubs match. Try another name or city.</p>
      ) : null}

      <ul className="space-y-3">
        {shown.map((club) => (
          <li key={club.slug}>
            <Link to={`/clubs/${club.slug}`} className="control-feedback card p-4 flex items-center gap-3">
              <span className="action-tile-icon shrink-0" aria-hidden><MapPin size={22} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-subtitle font-bold text-slate-900">{club.name}</span>
                {placeLine(club.address, club.city) ? (
                  <span className="block text-body text-slate-600">{placeLine(club.address, club.city)}</span>
                ) : null}
                <span className="block text-body text-slate-600">
                  {club.venue_count} {club.venue_count === 1 ? 'location' : 'locations'} · {club.court_count} {club.court_count === 1 ? 'court' : 'courts'}
                </span>
                <span className="block text-body font-semibold text-brand-800">{rateLine(club.min_rate, club.min_member_rate)}</span>
              </span>
              <ChevronRight className="text-slate-400 shrink-0" size={22} aria-hidden />
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

  if (club === undefined) return <Frame><LoadingBlock /></Frame>
  if (club === null) {
    return (
      <Frame>
        <Link to="/clubs" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2">All clubs</Link>
        <h1 className="text-heading-1 font-extrabold text-slate-950">This club is not taking bookings</h1>
        <p className="text-body text-slate-600">{error ?? 'Check the link, or pick another club from the list.'}</p>
      </Frame>
    )
  }

  const place = placeLine(club.address, club.city)
  const isPlatform = user?.role === 'superadmin'

  return (
    <Frame>
      <Link to="/clubs" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2">All clubs</Link>
      <header>
        <h1 className="text-heading-1 font-extrabold tracking-tight text-slate-950">{club.name}</h1>
        {place ? <p className="mt-1 text-body text-slate-600 flex items-center gap-1"><MapPin size={16} aria-hidden /> {place}</p> : null}
      </header>
      <p className="text-body text-slate-600">
        {user
          ? `Booking here adds you to ${club.name} as a player. Membership is optional; members pay the member rate where a court has one.`
          : 'Log in or create a free account to book. Membership is optional; members pay the member rate where a court has one.'}
      </p>
      {error ? <p role="alert" className="text-body text-red-700">{error}</p> : null}

      {club.venues.map((venue) => {
        const bookable = venue.courts.some((court) => court.in_service)
        return (
          <section key={venue.id} className="card p-4 space-y-3" aria-labelledby={`venue-${venue.id}`}>
            <div>
              <h2 id={`venue-${venue.id}`} className="text-title font-bold text-slate-900">{venue.name}</h2>
              <p className="text-body text-slate-600">Open {hourLabel(venue.open_hour)} to {hourLabel(venue.close_hour)}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {venue.courts.map((court) => (
                <li key={court.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{court.name}</span>
                    {court.in_service ? (
                      <span className="block text-body text-slate-600">
                        {peso(court.hourly_rate)} per hour
                        {court.member_rate != null && court.member_rate < court.hourly_rate ? ` · Members ${peso(court.member_rate)}` : ''}
                      </span>
                    ) : null}
                  </span>
                  {court.in_service ? null : <span className="pill pill-warn whitespace-nowrap">Out of service</span>}
                </li>
              ))}
              {venue.courts.length === 0 ? <li className="py-2 text-body text-slate-600">No courts listed yet.</li> : null}
            </ul>
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
