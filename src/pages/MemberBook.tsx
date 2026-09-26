import { useEffect, useMemo, useState } from 'react'
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
  CLUB_CLOSE_HOUR,
  fmtDate,
  fmtDateTime,
  hourLabel,
  peso,
  ymdLocal,
} from '../types'

type Step = 'pick' | 'pay' | 'done'

function nextDays(n: number) {
  const out: { ymd: string; label: string }[] = []
  const base = new Date()
  base.setHours(12, 0, 0, 0)
  for (let i = 0; i < n; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const ymd = ymdLocal(d)
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    out.push({ ymd, label })
  }
  return out
}

export function MemberBook() {
  const { user } = useAuth()
  const days = useMemo(() => nextDays(7), [])
  const [dateYmd, setDateYmd] = useState(days[0].ymd)
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueId, setVenueId] = useState('')
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
      if (!courtId && a[0]) setCourtId(a[0].court.id)
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
  const rate = selectedCourt?.court.hourly_rate ?? 0
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
                    {avail.map(({ court }) => (
                      <button
                        key={court.id}
                        type="button"
                        onClick={() => {
                          setCourtId(court.id)
                          setStartHour(null)
                        }}
                        className={`rounded-xl border px-3 py-3 text-left min-h-14 ${
                          courtId === court.id
                            ? 'border-brand-600 bg-brand-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <p className="font-extrabold">{court.name}</p>
                        <p className="text-xs text-slate-500">{peso(court.hourly_rate)}/hr</p>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="card p-3">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="label mb-0">Available times · {fmtDate(dateYmd + 'T12:00:00')}</p>
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
