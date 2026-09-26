import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Maximize2, RefreshCw } from 'lucide-react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { api } from '../lib/api'
import type { Venue } from '../types'
import type { Court, Role, ScheduleBlock } from '../types'
import { fmtTime, ymdLocal } from '../types'
import { CLUB_CLOSE_HOUR, CLUB_OPEN_HOUR } from '../types'

function kindColor(kind: ScheduleBlock['kind']) {
  if (kind === 'open_play') return 'bg-violet-500/90 border-violet-300'
  if (kind === 'booking') return 'bg-sky-500/90 border-sky-300'
  return 'bg-brand-600/95 border-brand-300'
}

export function ScheduleBoard({
  role,
  tv = false,
}: {
  role?: Role
  tv?: boolean
}) {
  const [dateYmd, setDateYmd] = useState(ymdLocal(new Date()))
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueId, setVenueId] = useState('')
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())

  async function reload() {
    setLoading(true)
    try {
      let selectedVenueId = venueId
      if (!tv && role && typeof api.listVenues === 'function') {
        const accessibleVenues = await api.listVenues(undefined, role)
        setVenues(accessibleVenues)
        selectedVenueId = venueId && accessibleVenues.some((venue) => venue.id === venueId)
          ? venueId
          : accessibleVenues[0]?.id ?? ''
        if (selectedVenueId !== venueId) setVenueId(selectedVenueId)
      }
      const schedule = tv && typeof api.publicDaySchedule === 'function'
        ? api.publicDaySchedule(dateYmd)
        : selectedVenueId
          ? api.daySchedule(dateYmd, selectedVenueId)
          : api.daySchedule(dateYmd)
      const courtsPromise = tv
        ? Promise.resolve([] as Court[])
        : selectedVenueId
          ? api.listCourts(selectedVenueId)
          : api.listCourts()
      const [b, c] = await Promise.all([schedule, courtsPromise])
      setBlocks(b)
      const tvCourts = b.filter((block): block is ScheduleBlock & { court_id: string } => typeof block.court_id === 'string')
      setCourts(tv ? Array.from(new Map(tvCourts.map((block) => [block.court_id, {
        id: block.court_id,
        name: block.court_name,
        status: 'occupied' as const,
        hourly_rate: 0,
      }])).values()) : c)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 30000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateYmd, venueId, role, tv])

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const hours = useMemo(() => {
    const h: number[] = []
    for (let i = CLUB_OPEN_HOUR; i < CLUB_CLOSE_HOUR; i++) h.push(i)
    return h
  }, [])

  const body = (
    <div className={tv ? 'min-h-screen bg-slate-950 text-white p-4 md:p-6' : 'safe-bottom px-4 pt-4 space-y-3'}>
      {tv ? (
        <header className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <p className="text-teal-300 text-xs font-bold uppercase tracking-widest">Rally Point · Live board</p>
            <h1 className="text-3xl md:text-4xl font-black mt-1">
              {new Date(dateYmd + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-4xl md:text-5xl font-black tabular-nums">
              {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-slate-400 text-sm mt-1">{blocks.length} blocks today</p>
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
            disabled={loading}
            aria-busy={loading}
            onClick={() => void reload()}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <Link to="/board/tv" target="_blank" className="btn-primary text-sm ml-auto">
            <Maximize2 size={14} /> TV mode
          </Link>
        </section>
      )}

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {/* Desktop grid */}
          <div className={`${tv ? 'hidden md:block' : 'hidden lg:block'} overflow-x-auto rounded-2xl border ${tv ? 'border-slate-800' : 'border-slate-200 bg-white'}`}>
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
                  {tv ? (
                    <>
                      <span className="block text-[10px] font-semibold text-slate-500 truncate">
                        {blocks.find((block) => block.court_id === c.id)?.venue_name ?? 'Venue'}
                      </span>
                      {c.name}
                    </>
                  ) : c.name}
                </div>
              ))}
              {hours.map((h) => (
                <div key={h} className="contents">
                  <div
                    className={`p-2 text-xs font-semibold border-t h-16 ${tv ? 'border-slate-800 text-slate-500' : 'border-slate-100 text-slate-400'}`}
                  >
                    {fmtTime(new Date(2000, 0, 1, h).toISOString())}
                  </div>
                  {courts.map((c) => {
                    const cellBlocks = blocks.filter((b) => {
                      if (b.court_id !== c.id) return false
                      const sh = new Date(b.start_at).getHours()
                      return sh === h
                    })
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
          <div className={`${tv ? 'md:hidden' : 'lg:hidden'} space-y-2`}>
            {blocks.length === 0 ? (
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

          <div className={`flex flex-wrap gap-3 text-xs ${tv ? 'text-slate-400 mt-4' : 'text-slate-500 pb-4'}`}>
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

export function TvBoard() {
  return <ScheduleBoard tv />
}
