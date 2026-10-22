import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, Loader2 } from 'lucide-react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { paymentConfig } from '../lib/payments'
import { isDemoMode } from '../lib/supabase'
import type {
  Booking,
  CourtDayAvailability,
  Member,
  PaymentMethod,
  Venue,
} from '../types'
import {
  APP_TIME_ZONE,
  CLUB_CLOSE_HOUR,
  courtRateFor,
  fmtDate,
  hasActiveMembership,
  fmtDateTime,
  hourLabel,
  peso,
  ymdLocal,
} from '../types'

type Step = 'pick' | 'pay' | 'done'

function nextDays(n: number) {
  // Days are counted in Philippine time, so "Today" matches the club's calendar on any phone.
  const out: { ymd: string; label: string }[] = []
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const ymd = ymdLocal(new Date(now + i * 86400000))
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', timeZone: APP_TIME_ZONE,
          })
    out.push({ ymd, label })
  }
  return out
}

export function MemberBook() {
  const { user } = useAuth()
  const days = useMemo(() => nextDays(7), [])
  const [dateYmd, setDateYmd] = useState(days[0].ymd)
  const [venues, setVenues] = useState<Venue[]>([])
  // A club page can open this screen on one of its venues.
  const location = useLocation()
  const [venueId, setVenueId] = useState(() => {
    const requested = (location.state as { venueId?: unknown } | null)?.venueId
    return typeof requested === 'string' ? requested : ''
  })
  const [hours, setHours] = useState(1)
  const [courtId, setCourtId] = useState<string | null>(null)
  const [startHour, setStartHour] = useState<number | null>(null)
  const [avail, setAvail] = useState<CourtDayAvailability[]>([])
  const [member, setMember] = useState<Member | null>(null)
  const [mine, setMine] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('pick')
  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [pending, setPending] = useState<Booking | null>(null)
  const [confirmed, setConfirmed] = useState<Booking | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const m = await api.memberForUser(user.id)
      setMember(m)
      const accessibleVenues = typeof api.listVenues === 'function' ? await api.listVenues(user.id, user.role) : []
      setVenues(accessibleVenues)
      const nextVenueId = venueId && accessibleVenues.some((venue) => venue.id === venueId)
        ? venueId
        : accessibleVenues[0]?.id ?? ''
      if (nextVenueId !== venueId) setVenueId(nextVenueId)
      const [a, b] = await Promise.all([
        api.availability(dateYmd, nextVenueId || undefined),
        m ? api.myBookings(m.id, nextVenueId || undefined) : Promise.resolve([] as Booking[]),
      ])
      setAvail(a)
      setMine(b)
      if (!courtId) {
        const firstBookable = a.find((row) => row.court.status !== 'maintenance') ?? a[0]
        if (firstBookable) setCourtId(firstBookable.court.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load availability')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dateYmd, venueId])

  const selectedCourt = avail.find((c) => c.court.id === courtId)
  // Members with an active membership pay the court's member rate; players pay the regular rate.
  const rate = selectedCourt ? courtRateFor(selectedCourt.court, member) : 0
  const isMember = hasActiveMembership(member)
  const total = rate * hours

  const slotOk = (h: number) => {
    if (!selectedCourt) return false
    for (let i = 0; i < hours; i++) {
      const slot = selectedCourt.slots.find((s) => s.startHour === h + i)
      if (!slot?.available) return false
      if (h + i >= CLUB_CLOSE_HOUR) return false
    }
    return true
  }

  async function goPay() {
    if (!isDemoMode) {
      setError('Online checkout is not available yet. Ask the desk to reserve this court.')
      return
    }
    if (!user || !member || !courtId || startHour == null) return
    setBusy(true)
    setError(null)
    try {
      const booking = await api.createBooking({
        court_id: courtId,
        venue_id: venueId || undefined,
        member_id: member.id,
        dateYmd,
        startHour,
        hours,
        user_id: user.id,
      })
      setPending(booking)
      setStep('pay')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hold slot')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function confirmPay() {
    if (!isDemoMode || !user || !pending) return
    setBusy(true)
    setError(null)
    try {
      const done = await api.payBooking({
        booking_id: pending.id,
        method,
        user_id: user.id,
      })
      setConfirmed(done)
      setStep('done')
      setPending(null)
      setStartHour(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      await reload()
      setStep('pick')
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell role="member">
      <AppHeader
        title="Book a court"
        subtitle={isDemoMode ? '1. Venue · 2. Date · 3. Court · 4. Pay' : 'View availability · reserve at the desk'}
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {!member && !loading ? (
          <section className="card p-4">
            <p className="font-bold">No membership linked</p>
            <p className="text-sm text-slate-500 mt-1">
              Ask the desk to link your account to a member profile before booking online.
            </p>
          </section>
        ) : null}

        {step === 'done' && confirmed ? (
          <section className="card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-700">
              <CheckCircle2 size={22} />
              <p className="font-extrabold text-lg">Booking confirmed</p>
            </div>
            <p className="text-sm text-slate-600">
              {confirmed.court?.name ?? 'Court'} · {fmtDateTime(confirmed.start_at)} · {confirmed.hours}h
            </p>
            <p className="text-sm font-bold">{peso(confirmed.amount)}</p>
            {confirmed.payment_ref ? (
              <p className="text-xs text-slate-500 font-mono">Ref {confirmed.payment_ref}</p>
            ) : null}
            <p className="text-xs text-slate-500">Show this at the desk when you arrive.</p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                setConfirmed(null)
                setStep('pick')
              }}
            >
              Book another
            </button>
          </section>
        ) : null}

        {step === 'pay' && pending ? (
          <section className="card p-4 space-y-4">
            <button
              type="button"
              className="text-sm font-bold text-brand-700 inline-flex items-center gap-1"
              onClick={() => {
                setStep('pick')
                setPending(null)
              }}
              disabled={busy}
            >
              <ChevronLeft size={16} /> Back
            </button>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Checkout</p>
              <p className="font-extrabold text-lg mt-0.5">
                {pending.court?.name ?? 'Court'} · {fmtDateTime(pending.start_at)}
              </p>
              <p className="text-sm text-slate-500">
                {pending.hours}h · {peso(pending.amount)}
              </p>
            </div>

            <div className="space-y-2">
              <p className="label">Pay with</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {paymentConfig.methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={`rounded-xl border px-3 py-3 text-left min-h-12 transition ${
                      method === m.id
                        ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/25'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-bold text-sm">{m.label}</p>
                    <p className="text-[11px] text-slate-500">{m.blurb}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">
                Demo checkout simulates {method.toUpperCase()}. Wire PayMongo secret via Edge Function for live
                e-wallets.
              </p>
            </div>

            {error ? <p className="text-sm text-red-600 font-medium">{error}</p> : null}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void confirmPay()}
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="animate-spin" size={18} /> Processing…
                </span>
              ) : (
                `Pay ${peso(pending.amount)}`
              )}
            </button>
          </section>
        ) : null}

        {step === 'pick' ? (
          <>
            <div className="px-1">
              <p className="text-body text-slate-600">
                {isMember ? 'You pay the member rate where a court has one.' : 'You pay the regular rate. Members pay less where a court has a member rate.'}
              </p>
              <Link to="/clubs" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2">
                Book at another club
              </Link>
            </div>
            {!isDemoMode ? (
              <section className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-extrabold">Online checkout is not available yet.</p>
                <p className="mt-1">Choose a venue and time to check availability, then ask the desk to reserve it.</p>
              </section>
            ) : null}

            {venues.length > 1 ? (
              <section className="card p-3">
                <label className="label px-1" htmlFor="member-book-venue">Venue</label>
                <select
                  id="member-book-venue"
                  className="input"
                  value={venueId}
                  onChange={(event) => {
                    setVenueId(event.target.value)
                    setCourtId(null)
                    setStartHour(null)
                  }}
                >
                  {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                </select>
              </section>
            ) : null}

            <section className="card p-3">
              <p className="label px-1 mb-2">Date</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => (
                  <button
                    key={d.ymd}
                    type="button"
                    onClick={() => {
                      setDateYmd(d.ymd)
                      setStartHour(null)
                    }}
                    className={`shrink-0 rounded-xl px-3 py-2 min-h-12 text-sm font-bold border ${
                      dateYmd === d.ymd
                        ? 'bg-brand-700 text-white border-brand-700'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="card p-3">
              <p className="label px-1 mb-2">Duration</p>
              <div className="flex gap-2">
                {[1, 2, 3].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setHours(h)
                      setStartHour(null)
                    }}
                    className={`flex-1 rounded-xl min-h-12 font-bold border ${
                      hours === h
                        ? 'bg-brand-700 text-white border-brand-700'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </section>

            {loading ? (
              <LoadingBlock />
            ) : (
              <>
                <section className="card p-3 space-y-3">
                  <p className="label px-1">Court</p>
                  <div className="grid grid-cols-2 gap-2">
                    {avail.map(({ court }) => {
                      const outOfService = court.status === 'maintenance'
                      return (
                        <button
                          key={court.id}
                          type="button"
                          disabled={outOfService}
                          onClick={() => {
                            setCourtId(court.id)
                            setStartHour(null)
                          }}
                          className={`rounded-xl border px-3 py-3 text-left min-h-14 ${
                            outOfService
                              ? 'border-slate-200 bg-slate-50 text-slate-500'
                              : courtId === court.id
                                ? 'border-brand-600 bg-brand-50'
                                : 'border-slate-200 bg-white'
                          }`}
                        >
                          <p className="font-extrabold">{court.name}</p>
                          <p className="text-xs text-slate-500">
                            {outOfService ? 'Out of service' : `${peso(courtRateFor(court, member))}/hr`}
                          </p>
                          {!outOfService && !isMember && court.member_rate != null && court.member_rate < court.hourly_rate ? (
                            <p className="text-xs text-brand-800">Members {peso(court.member_rate)}/hr</p>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="card p-3">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="label mb-0">Available times · {fmtDate(dateYmd + 'T12:00:00+08:00')}</p>
                    <p className="text-xs font-bold text-brand-700">{peso(total)}</p>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {(selectedCourt?.slots ?? []).map((s) => {
                      const ok = slotOk(s.startHour)
                      const active = startHour === s.startHour
                      return (
                        <button
                          key={s.startHour}
                          type="button"
                          disabled={!ok}
                          onClick={() => setStartHour(s.startHour)}
                          className={`rounded-xl min-h-12 text-sm font-bold border ${
                            active
                              ? 'bg-brand-700 text-white border-brand-700'
                              : ok
                                ? 'bg-white border-slate-200 text-slate-800'
                                : 'bg-slate-100 border-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          {hourLabel(s.startHour)}
                        </button>
                      )
                    })}
                  </div>
                </section>

                {error ? <p className="text-sm text-red-600 font-medium">{error}</p> : null}

                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={!isDemoMode || !member || startHour == null || busy}
                  aria-busy={busy}
                  onClick={() => void goPay()}
                >
                  {busy ? 'Holding slot…' : isDemoMode ? `Continue · ${peso(total)}` : 'Ask the desk to reserve'}
                </button>
              </>
            )}

            {mine.length > 0 ? (
              <section className="card p-4">
                <h2 className="font-extrabold mb-2">Your bookings</h2>
                {mine.slice(0, 8).map((b) => (
                  <div key={b.id} className="list-row">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">
                        {b.court?.name ?? 'Court'} · {fmtDateTime(b.start_at)}
                      </p>
                      <p className="text-xs text-slate-400 capitalize">
                        {b.status.replace('_', ' ')}
                        {b.payment_ref ? ` · ${b.payment_ref}` : ''}
                      </p>
                    </div>
                    <p className="font-bold text-sm">{peso(b.amount)}</p>
                  </div>
                ))}
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
