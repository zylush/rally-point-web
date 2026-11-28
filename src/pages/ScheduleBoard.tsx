import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Maximize2, RefreshCw } from 'lucide-react'
import { LeaderboardView } from '../components/LeaderboardView'
import { TournamentLiveView } from '../components/TournamentView'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { useClubLiveRefresh } from '../lib/livePulse'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'
import type {
  ClubLeaderboardSnapshot,
  Court,
  LeaderboardFormatFilter,
  LeaderboardPeriod,
  PublicClub,
  Role,
  ScheduleBlock,
  TournamentDetail,
  TournamentSummary,
  Venue,
} from '../types'
import { APP_TIME_ZONE, appHour, courtTypeLabel, fmtTime, hourLabel, ymdLocal } from '../types'
import { CLUB_CLOSE_HOUR, CLUB_OPEN_HOUR, venueHours } from '../types'

/** A TV board court: every court of the club, with its location, whether or not it has bookings. */
type BoardCourt = Court & { venue_name?: string }

function kindColor(kind: ScheduleBlock['kind']) {
  if (kind === 'open_play') return 'bg-violet-500/90 border-violet-300'
  if (kind === 'booking') return 'bg-sky-500/90 border-sky-300'
  return 'bg-brand-600/95 border-brand-300'
}

/** Sentence-case names for the kinds of block on the board. */
const kindLabel: Record<ScheduleBlock['kind'], string> = { session: 'Session', booking: 'Booking', open_play: 'Open play' }

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
  const [venues, setVenues] = useState<(Pick<Venue, 'id' | 'name'> & Partial<Pick<Venue, 'open_hour' | 'close_hour'>>)[]>([])
  const [venueId, setVenueId] = useState('')
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  // The TV board's location and mode choices live in its link (?venue=<id>&view=leaderboard|tournament).
  const [searchParams, setSearchParams] = useSearchParams()
  const tvVenueId = tv ? searchParams.get('venue') ?? '' : ''
  const tvViewParam = searchParams.get('view')
  const tvView: 'schedule' | 'leaderboard' | 'tournament' = tv
    ? tvViewParam === 'tournament'
      ? 'tournament'
      : tvViewParam === 'leaderboard'
        ? 'leaderboard'
        : 'schedule'
    : 'schedule'
  const tvTournamentParam = tv ? searchParams.get('tournament') ?? '' : ''

  const [lbPeriod, setLbPeriod] = useState<LeaderboardPeriod>('month')
  const [lbFormat, setLbFormat] = useState<LeaderboardFormatFilter>('all')
  const [lbSnapshot, setLbSnapshot] = useState<ClubLeaderboardSnapshot | null>(null)
  const [lbLoading, setLbLoading] = useState(tvView === 'leaderboard')
  const [lbError, setLbError] = useState<string | null>(null)
  const latestLeaderboardRequest = useRef(0)

  const [trList, setTrList] = useState<TournamentSummary[]>([])
  const [trDetail, setTrDetail] = useState<TournamentDetail | null>(null)
  const [trLoading, setTrLoading] = useState(tvView === 'tournament')
  const [trError, setTrError] = useState<string | null>(null)
  const latestTournamentRequest = useRef(0)

  const [refreshing, setRefreshing] = useState(false)
  const [updateFailed, setUpdateFailed] = useState(false)
  // Each reload takes a number; only the newest one may change the board, so a slow,
  // older request can't overwrite a newer date or location or end its loading early.
  const latestRequest = useRef(0)

  function updateTvParams(
    nextVenue: string,
    nextView: 'schedule' | 'leaderboard' | 'tournament',
    nextTournamentId?: string,
  ) {
    if (nextView === 'leaderboard' && !lbSnapshot) setLbLoading(true)
    if (nextView === 'tournament' && !trDetail) setTrLoading(true)
    const next: Record<string, string> = {}
    if (nextVenue) next.venue = nextVenue
    if (nextView === 'leaderboard') next.view = 'leaderboard'
    if (nextView === 'tournament') {
      next.view = 'tournament'
      const chosen = nextTournamentId ?? tvTournamentParam
      if (chosen) next.tournament = chosen
    }
    setSearchParams(next, { replace: true })
  }

  async function reloadLeaderboard(quiet = false) {
    if (!tv || tvView !== 'leaderboard' || typeof api.publicClubLeaderboard !== 'function') return
    const req = ++latestLeaderboardRequest.current
    if (!quiet) setLbLoading(true)
    setLbError(null)
    try {
      const next = await Promise.resolve(
        api.publicClubLeaderboard(club?.slug ?? DEFAULT_CLUB_SLUG, lbPeriod, lbFormat, 50),
      )
      if (req !== latestLeaderboardRequest.current) return
      setLbSnapshot(next)
    } catch (cause) {
      if (req === latestLeaderboardRequest.current) {
        setLbError(cause instanceof Error && cause.message ? cause.message : 'Could not load club leaderboard.')
      }
    } finally {
      if (req === latestLeaderboardRequest.current) setLbLoading(false)
    }
  }

  async function reloadTournament(quiet = false) {
    if (!tv || tvView !== 'tournament' || typeof api.listPublicClubTournaments !== 'function') return
    const req = ++latestTournamentRequest.current
    if (!quiet) setTrLoading(true)
    setTrError(null)
    const clubSlug = club?.slug ?? DEFAULT_CLUB_SLUG
    try {
      const rows = (await Promise.resolve(api.listPublicClubTournaments(clubSlug, 20))) ?? []
      if (req !== latestTournamentRequest.current) return
      setTrList(rows)
      const selected = rows.find((row) => row.id === tvTournamentParam)
        ?? rows.find((row) => row.status === 'live')
        ?? rows[0]
      if (!selected || typeof api.publicTournament !== 'function') {
        setTrDetail(null)
        return
      }
      const nextDetail = await Promise.resolve(api.publicTournament(clubSlug, selected.id))
      if (req !== latestTournamentRequest.current) return
      setTrDetail(nextDetail)
    } catch (cause) {
      if (req === latestTournamentRequest.current) {
        setTrError(cause instanceof Error && cause.message ? cause.message : 'Could not load tournament.')
      }
    } finally {
      if (req === latestTournamentRequest.current) setTrLoading(false)
    }
  }

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
        setVenues(allVenues.map((venue) => ({ id: venue.id, name: venue.name, open_hour: venue.open_hour, close_hour: venue.close_hour })))
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
          court_type: court.court_type ?? null,
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

  useEffect(() => {
    if (tv && tvView === 'leaderboard') {
      void reloadLeaderboard(false)
    } else if (tv && tvView === 'tournament') {
      void reloadTournament(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, tvView, tvTournamentParam, club?.slug, lbPeriod, lbFormat])

  useClubLiveRefresh(
    tv && tvView !== 'schedule' ? [club?.id, club?.slug ?? DEFAULT_CLUB_SLUG] : [],
    () => {
      if (tvView === 'leaderboard') void reloadLeaderboard(true)
      else if (tvView === 'tournament') void reloadTournament(true)
    },
    10000,
  )

  // Each venue keeps its own opening hours. The grid runs from the earliest opening to the
  // latest closing of the venues on screen; hours when a court's own venue is closed are shaded.
  const hoursByVenue = useMemo(
    () => new Map(venues.map((venue) => [venue.id, venueHours(venue.open_hour == null || venue.close_hour == null ? null : { open_hour: venue.open_hour, close_hour: venue.close_hour })])),
    [venues],
  )
  const courtHours = (court: BoardCourt) => hoursByVenue.get(court.venue_id ?? '') ?? venueHours(null)
  const shownHours = courts.map(courtHours)
  // A booking made before a venue changed its hours still shows: the grid stretches to cover it.
  const blockStarts = blocks.map((b) => appHour(b.start_at))
  const dayOpen = Math.min(shownHours.length ? Math.min(...shownHours.map((h) => h.open)) : CLUB_OPEN_HOUR, ...blockStarts)
  const dayClose = Math.max(shownHours.length ? Math.max(...shownHours.map((h) => h.close)) : CLUB_CLOSE_HOUR, ...blockStarts.map((h) => h + 1))
  // On today's TV board, start an hour back so the screen shows what is ahead. After closing
  // time there is nothing ahead, so the whole day shows rather than an empty grid.
  const isToday = dateYmd === ymdLocal(clock)
  const fromNow = Math.max(dayOpen, appHour(clock.toISOString()) - 1)
  const firstHour = tv && isToday && fromNow < dayClose ? fromNow : dayOpen
  const hours = useMemo(() => {
    const h: number[] = []
    for (let i = firstHour; i < dayClose; i++) h.push(i)
    return h
  }, [firstHour, dayClose])
  const showVenueNames = tv && new Set(courts.map((court) => court.venue_id)).size > 1

  const body = (
    <div className={tv ? 'min-h-screen bg-slate-950 text-white p-4 md:p-6' : 'safe-bottom px-4 pt-4 space-y-3'}>
      {tv ? (
        <header className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <p className="text-brand-200 text-xs font-semibold">
              {club?.name ?? 'bRineLy'}
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
          <div className="w-full flex flex-wrap items-center gap-2">
            {venues.length > 1 ? (
              <div>
                <label className="sr-only" htmlFor="tv-venue">Location</label>
                <select
                  id="tv-venue"
                  className="min-h-12 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                  value={tvVenueId}
                  onChange={(event) => updateTvParams(event.target.value, tvView)}
                >
                  <option value="">All locations</option>
                  {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="segmented segmented-dark segmented-fit" role="group" aria-label="TV board mode">
              <button
                type="button"
                aria-pressed={tvView === 'schedule'}
                onClick={() => updateTvParams(tvVenueId, 'schedule')}
              >
                Court schedule
              </button>
              <button
                type="button"
                aria-pressed={tvView === 'leaderboard'}
                onClick={() => updateTvParams(tvVenueId, 'leaderboard')}
              >
                Leaderboard
              </button>
              <button
                type="button"
                aria-pressed={tvView === 'tournament'}
                onClick={() => updateTvParams(tvVenueId, 'tournament')}
              >
                Tournament
              </button>
            </div>
            {tvView === 'tournament' && trList.length > 1 ? (
              <div>
                <label className="sr-only" htmlFor="tv-tournament-select">Tournament</label>
                <select
                  id="tv-tournament-select"
                  className="min-h-12 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                  value={trDetail?.tournament.id ?? tvTournamentParam}
                  onChange={(event) => updateTvParams(tvVenueId, 'tournament', event.target.value)}
                >
                  {trList.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
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

      {tv && tvView === 'leaderboard' ? (
        <LeaderboardView
          tone="dark"
          snapshot={lbSnapshot}
          loading={lbLoading}
          error={lbError}
          period={lbPeriod}
          onPeriodChange={setLbPeriod}
          format={lbFormat}
          onFormatChange={setLbFormat}
          onRetry={() => void reloadLeaderboard(false)}
        />
      ) : tv && tvView === 'tournament' ? (
        trDetail || trLoading || trError ? (
          <TournamentLiveView
            tone="dark"
            detail={trDetail}
            loading={trLoading}
            error={trError}
            onRetry={() => void reloadTournament(false)}
          />
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-slate-300">
            <p className="text-title font-bold text-white">No live tournament on this board yet</p>
            <p className="text-body mt-1">Once an admin starts a bracket or queue mixer, it will show up here live.</p>
          </section>
        )
      ) : (
        <>
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
                  {courtTypeLabel(c.court_type) ? (
                    <span className={`block text-xs font-semibold ${tv ? 'text-slate-400' : 'text-slate-500'}`}>{courtTypeLabel(c.court_type)}</span>
                  ) : null}
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
                    const { open, close } = courtHours(c)
                    const closed = h < open || h >= close
                    const closedTone = tv ? 'bg-slate-900' : 'bg-slate-100'
                    return (
                      <div
                        key={`${c.id}-${h}`}
                        className={`border-t border-l p-1 h-16 relative ${tv ? 'border-slate-800' : 'border-slate-100'} ${closed ? closedTone : ''}`}
                      >
                        {closed && cellBlocks.length === 0 ? (
                          <span className={`text-[11px] font-semibold ${tv ? 'text-slate-400' : 'text-slate-600'}`}>Closed</span>
                        ) : null}
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
                    <span className={`text-status font-semibold px-2 py-0.5 rounded-full ${
                      c.status === 'maintenance' ? 'bg-amber-400 text-amber-950' : courtBlocks.length ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-emerald-950'
                    }`}>
                      {c.status === 'maintenance' ? 'Out of service' : courtBlocks.length ? `${courtBlocks.length} booked` : 'Free'}
                    </span>
                  </div>
                  {courtTypeLabel(c.court_type) ? <p className="text-sm mt-1 text-slate-300">{courtTypeLabel(c.court_type)}</p> : null}
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
                      className={`text-status font-semibold px-2 py-0.5 rounded-full text-white ${kindColor(b.kind)}`}
                    >
                      {kindLabel[b.kind]}
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
      <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center">
        <p role="status" className="text-2xl font-semibold text-white">Loading the court board…</p>
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
