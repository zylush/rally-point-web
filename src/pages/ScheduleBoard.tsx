import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Maximize2, RefreshCw } from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type { PublicClub, Venue } from '../types'
import type { Court, Role, ScheduleBlock } from '../types'
import { APP_TIME_ZONE, appHour, fmtTime, hourLabel, ymdLocal } from '../types'
import { CLUB_CLOSE_HOUR, CLUB_OPEN_HOUR } from '../types'

/** A TV board court: every court of the club, with its location, whether or not it has bookings. */
type BoardCourt = Court & { venue_name?: string }

function kindColor(kind: ScheduleBlock['kind']) {
  if (kind === 'open_play') return 'bg-violet-500/90 border-violet-300'
  if (kind === 'booking') return 'bg-sky-500/90 border-sky-300'
  return 'bg-brand-600/95 border-brand-300'
}

/**
 * The board's shape while the day loads: the time grid on wide screens, court or booking
 * cards on narrow ones. The TV board uses still, dark shapes (no shimmer) so a wall
 * screen never shows a moving loop or a bright flash.
 */
function BoardLoading({ tv }: { tv: boolean }) {
  const shape = tv ? 'rounded-lg bg-slate-800' : ''
  const bar = (className: string) =>
    tv ? <div className={`${shape} ${className}`} /> : <SkeletonBlock className={className} />
  const columns = [0, 1, 2]
  return (
    <LoadingShapes label={tv ? 'Loading the court board…' : 'Loading the schedule…'} tone={tv ? 'dark' : 'light'}>
      <div aria-hidden className="space-y-2">
        <div className={`${tv ? 'hidden md:block border-slate-800' : 'hidden lg:block border-slate-200 bg-white'} overflow-hidden rounded-2xl border`}>
          <div className="grid" style={{ gridTemplateColumns: '72px repeat(3, minmax(140px, 1fr))' }}>
            <div className="p-2">{bar('h-4 w-10')}</div>
            {columns.map((key) => (
              <div key={key} className={`p-2 border-l ${tv ? 'border-slate-800' : 'border-slate-100'}`}>
                {bar('h-5 w-20')}
              </div>
            ))}
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="contents">
                <div className={`p-2 border-t h-16 ${tv ? 'border-slate-800' : 'border-slate-100'}`}>{bar('h-4 w-12')}</div>
                {columns.map((key) => (
                  <div key={key} className={`border-t border-l h-16 ${tv ? 'border-slate-800' : 'border-slate-100'}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className={`${tv ? 'md:hidden' : 'lg:hidden'} space-y-2`}>
          {columns.map((key) => (
            <div
              key={key}
              className={`rounded-2xl p-4 border ${tv ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}
            >
              {tv ? (
                <div className="flex items-center justify-between gap-2">
                  <div className={`${shape} h-5 w-24`} />
                  <div className="h-5 w-14 rounded-full bg-slate-800" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <SkeletonLine size="subtitle" className="w-2/5" />
                    <SkeletonBlock className="h-5 w-16 rounded-full!" />
                  </div>
                  <SkeletonLine className="w-3/5 mt-1" />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </LoadingShapes>
  )
}

export function ScheduleBoard({
  role,
  tv = false,
  club,
}: {
  role?: Role
  tv?: boolean
  /** The club a public TV board shows (from its link). */
  club?: PublicClub | null
}) {
  const { activeClub } = useAuth()
  const [dateYmd, setDateYmd] = useState(ymdLocal(new Date()))
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([])
  const [courts, setCourts] = useState<BoardCourt[]>([])
  const [venues, setVenues] = useState<Pick<Venue, 'id' | 'name'>[]>([])
  const [venueId, setVenueId] = useState('')
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  // The TV board's location choice lives in its link (?venue=<id>), so each screen keeps its own.
  const [searchParams, setSearchParams] = useSearchParams()
  const tvVenueId = tv ? searchParams.get('venue') ?? '' : ''

  const [refreshing, setRefreshing] = useState(false)
  const [updateFailed, setUpdateFailed] = useState(false)
  // Each reload takes a number; only the newest one may change the board, so a slow,
  // older request can't overwrite a newer date or location or end its loading early.
  const latestRequest = useRef(0)

  // The 30-second poll and the Refresh button reload quietly: the board stays on screen and
  // updates in place, instead of flashing back to the placeholder and fading in again.
  // A failed reload keeps the last board and shows a short note until the next success.
  async function reload(quiet = false) {
    const request = ++latestRequest.current
    const isLatest = () => request === latestRequest.current
    if (!quiet) setLoading(true)
    try {
      if (tv) {
        // Every court of the club comes from its public page, so free courts show too.
        const detail = club && typeof api.publicClubDetail === 'function' ? await api.publicClubDetail(club.slug) : null
        if (!isLatest()) return
        const allVenues = detail?.venues ?? []
        setVenues(allVenues.map((venue) => ({ id: venue.id, name: venue.name })))
        const shownVenues = tvVenueId ? allVenues.filter((venue) => venue.id === tvVenueId) : allVenues
        const b = typeof api.publicDaySchedule === 'function'
          ? await api.publicDaySchedule(dateYmd, tvVenueId || undefined, club?.id)
          : []
        if (!isLatest()) return
        setBlocks(b)
        setUpdateFailed(false)
        setCourts(shownVenues.flatMap((venue) => venue.courts.map((court) => ({
          id: court.id,
          venue_id: venue.id,
          venue_name: venue.name,
          name: court.name,
          status: court.in_service ? 'available' as const : 'maintenance' as const,
          hourly_rate: court.hourly_rate,
        }))))
        return
      }
      let selectedVenueId = venueId
      if (role && typeof api.listVenues === 'function') {
        const accessibleVenues = await api.listVenues(undefined, role)
        if (!isLatest()) return
        setVenues(accessibleVenues)
        selectedVenueId = venueId && accessibleVenues.some((venue) => venue.id === venueId)
          ? venueId
          : accessibleVenues[0]?.id ?? ''
        if (selectedVenueId !== venueId) setVenueId(selectedVenueId)
      }
      const [b, c] = await Promise.all([
        selectedVenueId ? api.daySchedule(dateYmd, selectedVenueId) : api.daySchedule(dateYmd),
        selectedVenueId ? api.listCourts(selectedVenueId) : api.listCourts(),
      ])
      if (!isLatest()) return
      setBlocks(b)
      setCourts(c)
      setUpdateFailed(false)
    } catch {
      if (isLatest()) setUpdateFailed(true)
    } finally {
      if (isLatest()) setLoading(false)
    }
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await reload(true)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(true), 30000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateYmd, venueId, tvVenueId, role, tv, club?.id, club?.slug])

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Booking runs around the clock. On today's TV board, start an hour back so the screen shows what is ahead.
  const isToday = dateYmd === ymdLocal(clock)
  const firstHour = tv && isToday ? Math.max(CLUB_OPEN_HOUR, appHour(clock.toISOString()) - 1) : CLUB_OPEN_HOUR
  const hours = useMemo(() => {
    const h: number[] = []
    for (let i = firstHour; i < CLUB_CLOSE_HOUR; i++) h.push(i)
    return h
  }, [firstHour])
  const showVenueNames = tv && new Set(courts.map((court) => court.venue_id)).size > 1

  const body = (
    <div className={tv ? 'min-h-screen bg-slate-950 text-white p-4 md:p-6' : 'safe-bottom px-4 pt-4 space-y-3'}>
      {tv ? (
        <header className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <p className="text-teal-300 text-xs font-bold uppercase tracking-widest">
              {club?.name ?? 'Rally Point'}
              {tvVenueId ? ` · ${venues.find((venue) => venue.id === tvVenueId)?.name ?? ''}` : ''} · Live board
            </p>
            <h1 className="text-3xl md:text-4xl font-black mt-1">
              {new Date(dateYmd + 'T12:00:00+08:00').toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                timeZone: APP_TIME_ZONE,
              })}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-4xl md:text-5xl font-black tabular-nums">
              {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: APP_TIME_ZONE })}
            </p>
            <p className="text-slate-400 text-sm mt-1">
              {courts.length} {courts.length === 1 ? 'court' : 'courts'} · {blocks.length} {blocks.length === 1 ? 'booking' : 'bookings'} today
            </p>
          </div>
          {venues.length > 1 ? (
            <div className="w-full">
              <label className="sr-only" htmlFor="tv-venue">Location</label>
              <select
                id="tv-venue"
                className="min-h-12 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                value={tvVenueId}
                onChange={(event) => setSearchParams(event.target.value ? { venue: event.target.value } : {}, { replace: true })}
              >
                <option value="">All locations</option>
                {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
              </select>
            </div>
          ) : null}
        </header>
      ) : (
        <section className="card p-3 flex flex-wrap gap-2 items-center">
          {venues.length > 1 ? (
            <label className="sr-only" htmlFor="schedule-venue">Venue</label>
          ) : null}
          {venues.length > 1 ? (
            <select id="schedule-venue" className="input max-w-[12rem]" value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
          ) : null}
          <input
            type="date"
            className="input max-w-[11rem]"
            value={dateYmd}
            onChange={(e) => setDateYmd(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-sm"
            aria-disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <Link to={activeClub ? `/board/tv/${activeClub.slug}` : '/board/tv'} target="_blank" className="btn-primary text-sm ml-auto">
            <Maximize2 size={14} /> TV mode
          </Link>
        </section>
      )}

      {updateFailed ? (
        <p role="status" className={tv ? 'text-base text-slate-300 mb-3' : 'text-body text-slate-600 px-1'}>
          Couldn't update. Trying again.
        </p>
      ) : null}

      {loading ? (
        <BoardLoading tv={tv} />
      ) : (
        <>
          {/* Desktop grid. Each part fades in once when the day first loads; the poll updates it in place. */}
          <div className={`enter-fade ${tv ? 'hidden md:block' : 'hidden lg:block'} overflow-x-auto rounded-2xl border ${tv ? 'border-slate-800' : 'border-slate-200 bg-white'}`}>
            <div
              className="grid min-w-[720px]"
              style={{ gridTemplateColumns: `72px repeat(${Math.max(courts.length, 1)}, minmax(140px, 1fr))` }}
            >
              <div className={`p-2 text-xs font-bold ${tv ? 'text-slate-500' : 'text-slate-400'}`}>Time</div>
              {courts.map((c) => (
                <div
                  key={c.id}
                  className={`p-2 text-sm font-extrabold border-l ${tv ? 'border-slate-800' : 'border-slate-100'}`}
                >
                  {showVenueNames ? (
                    <span className="block text-[10px] font-semibold text-slate-500 truncate">{c.venue_name}</span>
                  ) : null}
                  {c.name}
                  {c.status === 'maintenance' ? (
                    <span className={`block text-[10px] font-semibold ${tv ? 'text-amber-300' : 'text-amber-700'}`}>Out of service</span>
                  ) : null}
                </div>
              ))}
              {hours.map((h) => (
                <div key={h} className="contents">
                  <div
                    className={`p-2 text-xs font-semibold border-t h-16 ${tv ? 'border-slate-800 text-slate-500' : 'border-slate-100 text-slate-400'}`}
                  >
                    {hourLabel(h)}
                  </div>
                  {courts.map((c) => {
                    const cellBlocks = blocks.filter((b) => b.court_id === c.id && appHour(b.start_at) === h)
                    return (
                      <div
                        key={`${c.id}-${h}`}
                        className={`border-t border-l p-1 h-16 relative ${tv ? 'border-slate-800' : 'border-slate-100'}`}
                      >
                        {cellBlocks.map((b) => (
                          <div
                            key={b.id}
                            className={`absolute inset-1 rounded-lg border px-1.5 py-1 text-[10px] leading-tight overflow-hidden ${kindColor(b.kind)} text-white`}
                          >
                            <p className="font-bold truncate">{b.title}</p>
                            <p className="opacity-90 truncate">
                              {fmtTime(b.start_at)}–{fmtTime(b.end_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Mobile / list */}
          <div className={`enter-fade ${tv ? 'md:hidden' : 'lg:hidden'} space-y-2`}>
            {tv ? courts.map((c) => {
              const courtBlocks = blocks.filter((b) => b.court_id === c.id)
              return (
                <div key={c.id} className="rounded-2xl p-4 border bg-slate-900 border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-extrabold">{c.name}</p>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      c.status === 'maintenance' ? 'bg-amber-400 text-amber-950' : courtBlocks.length ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-emerald-950'
                    }`}>
                      {c.status === 'maintenance' ? 'Out of service' : courtBlocks.length ? `${courtBlocks.length} booked` : 'Free'}
                    </span>
                  </div>
                  {showVenueNames ? <p className="text-xs mt-1 text-slate-400">{c.venue_name}</p> : null}
                  {courtBlocks.map((b) => (
                    <p key={b.id} className="text-sm mt-1 text-slate-300">
                      {fmtTime(b.start_at)} – {fmtTime(b.end_at)} · {b.title}
                    </p>
                  ))}
                </div>
              )
            }) : null}
            {tv ? null : blocks.length === 0 ? (
              <p className={`text-sm ${tv ? 'text-slate-400' : 'text-slate-500'} card p-4`}>Nothing scheduled.</p>
            ) : (
              blocks.map((b) => (
                <div
                  key={b.id}
                  className={`rounded-2xl p-4 border ${tv ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-extrabold">{b.title}</p>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white ${kindColor(b.kind)}`}
                    >
                      {b.kind.replace('_', ' ')}
                    </span>
                  </div>
                  {b.venue_name ? (
                    <p className={`text-xs mt-1 ${tv ? 'text-slate-400' : 'text-slate-500'}`}>{b.venue_name}</p>
                  ) : null}
                  <p className={`text-sm mt-1 ${tv ? 'text-slate-300' : 'text-slate-600'}`}>
                    {b.court_name} · {fmtTime(b.start_at)} – {fmtTime(b.end_at)}
                  </p>
                  {b.subtitle ? (
                    <p className={`text-xs mt-0.5 capitalize ${tv ? 'text-slate-500' : 'text-slate-400'}`}>
                      {b.subtitle}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className={`enter-fade flex flex-wrap gap-3 text-xs ${tv ? 'text-slate-400 mt-4' : 'text-slate-500 pb-4'}`}>
            <span className="inline-flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm bg-brand-600 inline-block" /> Rental / session
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" /> Online booking
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" /> Open play
            </span>
          </div>
        </>
      )}
    </div>
  )

  if (tv || !role) return body

  return (
    <AppShell role={role}>
      <AppHeader title="Schedule board" subtitle="Day view · floor TV" right={<SignOutButton />} />
      {body}
    </AppShell>
  )
}

export function StaffBoard() {
  return <ScheduleBoard role="staff" />
}

export function AdminBoard() {
  return <ScheduleBoard role="admin" />
}

/** Public club screen. Without a club link it shows the default Rally Point Gensan club. */
export function TvBoard() {
  const { slug } = useParams()
  // undefined = still looking the club up; null = the link names no active club.
  const [club, setClub] = useState<PublicClub | null | undefined>(undefined)
  const canLookUp = typeof api.publicClub === 'function'

  useEffect(() => {
    if (!canLookUp) return
    let cancelled = false
    api
      .publicClub(slug ?? DEFAULT_CLUB_SLUG)
      .then((found) => {
        if (!cancelled) setClub(found)
      })
      .catch(() => {
        if (!cancelled) setClub(null)
      })
    return () => {
      cancelled = true
    }
  }, [slug, canLookUp])

  if (!canLookUp) return <ScheduleBoard tv />
  if (club === undefined) {
    return (
      <div className="min-h-screen bg-slate-950">
        <p role="status" className="sr-only">Loading the court board…</p>
      </div>
    )
  }
  if (club === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center text-white">
        <p className="text-2xl font-bold">This club board is not available.</p>
      </div>
    )
  }
  return <ScheduleBoard tv club={club} />
}
