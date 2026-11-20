import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, Loader2, MailCheck } from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { PublicFrame } from '../components/PublicFrame'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { paymentConfig } from '../lib/payments'
import { isDemoMode } from '../lib/supabase'
import LoginPage from './LoginPage'
import type {
  Booking,
  CourtDayAvailability,
  Member,
  PaymentMethod,
  Profile,
  Venue,
} from '../types'
import {
  APP_TIME_ZONE,
  appHour,
  CLUB_CLOSE_HOUR,
  CLUB_OPEN_HOUR,
  courtRateFor,
  fmtDate,
  fmtDateTime,
  fmtTime,
  hasActiveMembership,
  hourLabel,
  localRangeISO,
  peso,
  ymdLocal,
} from '../types'

const BOOKING_INTENT_KEY = 'brinely_booking_intent'

interface BookingIntent {
  clubSlug: string
  venueId: string
  courtId: string | null
  dateYmd: string
  startHour: number
  hours: number
  autoCheckout: boolean
}

function readBookingIntent(slug?: string): BookingIntent | null {
  if (!slug) return null
  try {
    const raw = sessionStorage.getItem(BOOKING_INTENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BookingIntent
    return parsed.clubSlug === slug ? parsed : null
  } catch {
    return null
  }
}

function saveBookingIntent(intent: BookingIntent) {
  try {
    sessionStorage.setItem(BOOKING_INTENT_KEY, JSON.stringify(intent))
  } catch {
    // Ignore storage errors in restricted browsing modes.
  }
}

function clearBookingIntent() {
  try {
    sessionStorage.removeItem(BOOKING_INTENT_KEY)
  } catch {
    // Ignore storage errors.
  }
}

type Step = 'pick' | 'pay' | 'done'

/** The court picker, the time grid and the continue button, while a day's availability loads. */
function AvailabilityLoading() {
  return (
    <LoadingShapes label="Loading available courts and times…">
      <div className="space-y-4" aria-hidden>
        <div className="card p-3 space-y-3">
          <SkeletonLine className="w-14 px-1" />
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((key) => (
              <SkeletonBlock key={key} className="h-16 rounded-xl!" />
            ))}
          </div>
        </div>
        <div className="card p-3">
          <div className="flex items-center justify-between px-1 mb-2">
            <SkeletonLine className="w-1/2" />
            <SkeletonLine size="caption" className="w-12" />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Array.from({ length: CLUB_CLOSE_HOUR - CLUB_OPEN_HOUR }, (_, key) => (
              <SkeletonBlock key={key} className="h-12 rounded-xl!" />
            ))}
          </div>
        </div>
        <SkeletonBlock className="h-[54px] w-full rounded-[16px]!" />
      </div>
    </LoadingShapes>
  )
}

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
  const { user, activeClub, joinClub } = useAuth()
  const { slug: routeClubSlug } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const savedIntent = useMemo(() => readBookingIntent(routeClubSlug), [routeClubSlug])
  const days = useMemo(() => nextDays(7), [])
  const [dateYmd, setDateYmd] = useState(() => {
    if (savedIntent?.dateYmd && days.some((d) => d.ymd === savedIntent.dateYmd)) return savedIntent.dateYmd
    return days[0].ymd
  })
  const [clubName, setClubName] = useState<string | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueId, setVenueId] = useState(() => {
    if (savedIntent?.venueId) return savedIntent.venueId
    const paramVenue = searchParams.get('venue')
    if (paramVenue) return paramVenue
    const requested = (location.state as { venueId?: unknown } | null)?.venueId
    return typeof requested === 'string' ? requested : ''
  })
  const [hours, setHours] = useState(() => savedIntent?.hours ?? 1)
  const [courtId, setCourtId] = useState<string | null>(() => {
    if (savedIntent?.courtId) return savedIntent.courtId
    const paramCourt = searchParams.get('court')
    if (paramCourt) return paramCourt
    const requested = (location.state as { courtId?: unknown } | null)?.courtId
    return typeof requested === 'string' ? requested : null
  })
  const [startHour, setStartHour] = useState<number | null>(() => savedIntent?.startHour ?? null)
  const [avail, setAvail] = useState<CourtDayAvailability[]>([])
  const [member, setMember] = useState<Member | null>(null)
  const [mine, setMine] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('pick')
  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [pending, setPending] = useState<Booking | null>(null)
  const [confirmed, setConfirmed] = useState<Booking | null>(null)
  const [emailReceipt, setEmailReceipt] = useState<string | null>(null)
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availCacheRef = useRef<Map<string, CourtDayAvailability[]>>(new Map())
  const [bootstrappedKey, setBootstrappedKey] = useState<string | null>(null)
  const autoCheckoutPendingRef = useRef(Boolean(savedIntent?.autoCheckout))

  const isPlayerUser = Boolean(user && (user.role === 'member' || user.role === 'admin'))
  const publicBrowsingMode = Boolean(routeClubSlug && (!isPlayerUser || activeClub?.slug !== routeClubSlug))
  const expectedBootstrapKey = routeClubSlug
    ? `${routeClubSlug}:${user?.id ?? 'guest'}:${activeClub?.club_id ?? 'none'}`
    : user?.id ?? 'none'

  const markSlotsBookedInState = useCallback((booking: Booking) => {
    const bookedYmd = ymdLocal(new Date(booking.start_at))
    const bookedStart = appHour(booking.start_at)
    const bookedEnd = bookedStart + booking.hours
    const applyBooked = (rows: CourtDayAvailability[]) =>
      rows.map((row) =>
        row.court.id !== booking.court_id
          ? row
          : {
              ...row,
              slots: row.slots.map((slot) =>
                slot.startHour >= bookedStart && slot.startHour < bookedEnd
                  ? { ...slot, available: false }
                  : slot,
              ),
            },
      )

    const cacheKey = `${routeClubSlug ?? activeClub?.slug ?? 'default'}:${booking.venue_id ?? venueId}:${bookedYmd}`
    const cached = availCacheRef.current.get(cacheKey)
    if (cached) {
      availCacheRef.current.set(cacheKey, applyBooked(cached))
    }
    if (bookedYmd === dateYmd) {
      setAvail((prev) => applyBooked(prev))
    }
  }, [dateYmd, venueId, routeClubSlug, activeClub?.slug])

  // Load club/venue/member context once per user or club context change.
  useEffect(() => {
    if (!routeClubSlug && !user) return
    let active = true
    setLoading(true)
    setError(null)
    availCacheRef.current.clear()
    void (async () => {
      try {
        if (routeClubSlug && (!isPlayerUser || (activeClub && activeClub.slug !== routeClubSlug))) {
          if (isPlayerUser && typeof joinClub === 'function') {
            await joinClub(routeClubSlug, { asPlayer: true })
            if (!active) return
          } else {
            const detail = typeof api.publicClubDetail === 'function' ? await api.publicClubDetail(routeClubSlug) : null
            if (!active) return
            if (!detail) {
              setError('This club is not taking bookings.')
              setLoading(false)
              return
            }
            setClubName(detail.name)
            const publicVenues: Venue[] = detail.venues.map((v) => ({
              id: v.id,
              club_id: routeClubSlug,
              slug: v.id,
              name: v.name,
              timezone: APP_TIME_ZONE,
              open_hour: v.open_hour,
              close_hour: v.close_hour,
              is_active: true,
            }))
            setMember(null)
            setVenues(publicVenues)
            setVenueId((current) =>
              current && publicVenues.some((venue) => venue.id === current)
                ? current
                : publicVenues[0]?.id ?? '',
            )
            setBootstrappedKey(expectedBootstrapKey)
            return
          }
        }

        if (!user) return
        if (routeClubSlug && !activeClub && typeof joinClub === 'function') {
          await joinClub(routeClubSlug, { asPlayer: true })
          if (!active) return
        }
        const [m, accessibleVenues] = await Promise.all([
          api.memberForUser(user.id),
          typeof api.listVenues === 'function' ? api.listVenues(user.id, user.role) : Promise.resolve([] as Venue[]),
        ])
        if (!active) return
        setClubName(activeClub?.name ?? null)
        setMember(m)
        setVenues(accessibleVenues)
        setVenueId((current) =>
          current && accessibleVenues.some((venue) => venue.id === current)
            ? current
            : accessibleVenues[0]?.id ?? '',
        )
        setBootstrappedKey(expectedBootstrapKey)
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load availability')
          setLoading(false)
        }
      }
    })()
    return () => { active = false }
  }, [user, routeClubSlug, activeClub, isPlayerUser, joinClub, expectedBootstrapKey])

  // Load user's bookings only when signed-in member or selected venue changes (not on every date tap).
  useEffect(() => {
    if (!user || bootstrappedKey !== expectedBootstrapKey || !member || publicBrowsingMode) return
    let active = true
    void (async () => {
      try {
        const rows = await api.myBookings(member.id, venueId || undefined)
        if (active) setMine(rows)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load bookings')
      }
    })()
    return () => { active = false }
  }, [user, bootstrappedKey, expectedBootstrapKey, member, venueId, publicBrowsingMode])

  const loadAvailability = useCallback(async (forceRefresh = false) => {
    if (bootstrappedKey !== expectedBootstrapKey) return
    const cacheKey = `${routeClubSlug ?? activeClub?.slug ?? 'default'}:${venueId}:${dateYmd}`
    const pickCourtId = (rows: CourtDayAvailability[]) => {
      setCourtId((current) => {
        if (current && rows.some((row) => row.court.id === current && row.court.status !== 'maintenance')) return current
        const firstBookable = rows.find((row) => row.court.status !== 'maintenance') ?? rows[0]
        return firstBookable?.court.id ?? null
      })
    }
    if (!forceRefresh) {
      const cached = availCacheRef.current.get(cacheKey)
      if (cached) {
        setAvail(cached)
        setLoading(false)
        pickCourtId(cached)
        return
      }
    }
    setLoading(true)
    setError(null)
    try {
      const a = routeClubSlug && publicBrowsingMode && typeof api.publicClubAvailability === 'function'
        ? await api.publicClubAvailability(routeClubSlug, dateYmd, venueId || undefined)
        : await api.availability(dateYmd, venueId || undefined)
      availCacheRef.current.set(cacheKey, a)
      setAvail(a)
      pickCourtId(a)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load availability')
    } finally {
      setLoading(false)
    }
  }, [bootstrappedKey, expectedBootstrapKey, routeClubSlug, activeClub?.slug, publicBrowsingMode, venueId, dateYmd])

  useEffect(() => {
    void loadAvailability(false)
  }, [loadAvailability])

  const selectedCourt = avail.find((c) => c.court.id === courtId)
  // Members with an active membership pay the court's member rate; players pay the regular rate.
  const rate = selectedCourt ? courtRateFor(selectedCourt.court, member) : 0
  const isMember = hasActiveMembership(member)
  const total = rate * hours

  // Map hours already booked/held by this user on the active court & date for clear "Booked" indicators.
  const myHoursOnCourt = useMemo(() => {
    const map = new Map<number, Booking>()
    if (!courtId) return map
    for (const b of mine) {
      if (b.court_id !== courtId) continue
      if (b.status !== 'confirmed' && b.status !== 'pending_payment') continue
      if (ymdLocal(new Date(b.start_at)) !== dateYmd) continue
      const start = appHour(b.start_at)
      for (let i = 0; i < b.hours; i++) {
        map.set(start + i, b)
      }
    }
    return map
  }, [mine, courtId, dateYmd])

  const slotOk = (h: number) => {
    if (!selectedCourt) return false
    for (let i = 0; i < hours; i++) {
      const slot = selectedCourt.slots.find((s) => s.startHour === h + i)
      if (!slot?.available) return false
      if (h + i >= CLUB_CLOSE_HOUR) return false
    }
    return true
  }

  const proceedToCheckout = useCallback(async (activeUser: Profile, activeMember: Member) => {
    if (!courtId || startHour == null) return
    if (!isDemoMode) {
      setError('Online checkout is not available yet. Ask the desk to reserve this court.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const booking = await api.createBooking({
        court_id: courtId,
        venue_id: venueId || undefined,
        member_id: activeMember.id,
        dateYmd,
        startHour,
        hours,
        user_id: activeUser.id,
      })
      clearBookingIntent()
      setPending(booking)
      setStep('pay')
    } catch (e) {
      clearBookingIntent()
      setError(e instanceof Error ? e.message : 'Could not hold slot')
      await loadAvailability(true)
    } finally {
      setBusy(false)
    }
  }, [courtId, startHour, venueId, dateYmd, hours, loadAvailability])

  // Resume straight into checkout if the user just authenticated and <Routes> remounted MemberBook.
  useEffect(() => {
    if (!autoCheckoutPendingRef.current) return
    if (!isPlayerUser || !user || !member || bootstrappedKey !== expectedBootstrapKey) return
    if (routeClubSlug && activeClub?.slug !== routeClubSlug) return
    autoCheckoutPendingRef.current = false
    clearBookingIntent()
    void proceedToCheckout(user, member)
  }, [isPlayerUser, user, member, bootstrappedKey, expectedBootstrapKey, routeClubSlug, activeClub?.slug, proceedToCheckout])

  async function goPay() {
    if (startHour == null || !courtId) return
    setError(null)

    if (!user) {
      if (routeClubSlug) {
        saveBookingIntent({
          clubSlug: routeClubSlug,
          venueId,
          courtId,
          dateYmd,
          startHour,
          hours,
          autoCheckout: true,
        })
      }
      setAuthDialogOpen(true)
      return
    }

    if (!isPlayerUser) {
      setError('Only member accounts can book courts online. Please sign in with a member account.')
      return
    }

    if (!isDemoMode) {
      setError('Online checkout is not available yet. Ask the desk to reserve this court.')
      return
    }

    if (!member) return
    await proceedToCheckout(user, member)
  }

  async function handleDialogAuthenticated(profile: Profile) {
    setAuthDialogOpen(false)
    if (profile.role !== 'member' && profile.role !== 'admin') {
      clearBookingIntent()
      setError('Only member accounts can book courts online.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (routeClubSlug && typeof joinClub === 'function') {
        await joinClub(routeClubSlug, { asPlayer: true })
      }
      const m = await api.memberForUser(profile.id)
      if (!m) {
        clearBookingIntent()
        setError('Your club player profile is not ready yet. Please try again.')
        return
      }
      setMember(m)
      autoCheckoutPendingRef.current = false
      clearBookingIntent()
      await proceedToCheckout(profile, m)
    } catch (e) {
      clearBookingIntent()
      setError(e instanceof Error ? e.message : 'Could not continue to checkout')
    } finally {
      setBusy(false)
    }
  }

  async function confirmPay() {
    if (!isDemoMode || !user || !pending) return
    setBusy(true)
    setError(null)
    setEmailReceipt(null)
    try {
      const done = await api.payBooking({
        booking_id: pending.id,
        method,
        user_id: user.id,
      })
      setConfirmed(done)
      setMine((prev) => [done, ...prev.filter((item) => item.id !== done.id)])
      markSlotsBookedInState(done)
      if (typeof api.sendBookingConfirmationEmail === 'function') {
        try {
          const venueObj = venues.find((v) => v.id === (done.venue_id ?? venueId))
          const receipt = await api.sendBookingConfirmationEmail({
            booking: done,
            clubName: clubName ?? activeClub?.name ?? 'bRineLy',
            venueName: venueObj?.name,
            recipientEmail: user.email,
          })
          if (receipt?.preview) setEmailReceipt(receipt.preview)
        } catch {
          // Email receipt failures never roll back a paid booking.
        }
      }
      setStep('done')
      setPending(null)
      setStartHour(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      await loadAvailability(true)
      setStep('pick')
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  const pageTitle = clubName ? `Book at ${clubName}` : 'Book a court'
  const pageSubtitle = isDemoMode
    ? '1. Venue · 2. Date · 3. Court · 4. Pay'
    : 'View availability · reserve at the desk'

  const content: ReactNode = (
    <>
      {authDialogOpen ? (
        <LoginPage
          dialog
          clubName={clubName ?? activeClub?.name}
          onClose={() => {
            setAuthDialogOpen(false)
            autoCheckoutPendingRef.current = false
            clearBookingIntent()
          }}
          onAuthenticated={(profile) => {
            void handleDialogAuthenticated(profile)
          }}
        />
      ) : null}

      {routeClubSlug ? (
        <Link
          to={`/clubs/${routeClubSlug}`}
          className="control-feedback inline-flex min-h-11 items-center gap-1 text-body font-semibold text-brand-800"
        >
          <ChevronLeft size={18} aria-hidden /> Back to {clubName ?? 'club'}
        </Link>
      ) : null}

      {user && !member && !loading && !publicBrowsingMode ? (
        <section className="card p-4">
          <p className="font-bold">No membership linked</p>
          <p className="text-sm text-slate-500 mt-1">
            Ask the desk to link your account to a member profile before booking online.
          </p>
        </section>
      ) : null}

      {step === 'done' && confirmed ? (
        <section className="enter-rise card p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-brand-700">
              <CheckCircle2 size={22} />
              <p className="font-extrabold text-lg">Booking confirmed</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="pill pill-ok">
                Booked · {confirmed.hours} {confirmed.hours === 1 ? 'hour' : 'hours'}
              </span>
              <span className="pill pill-warn">No refund</span>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            {confirmed.court?.name ?? 'Court'} · {fmtDateTime(confirmed.start_at)} – {fmtTime(confirmed.end_at)} · {confirmed.hours}h
          </p>
          <p className="text-sm font-bold">{peso(confirmed.amount)}</p>
          {confirmed.payment_ref ? (
            <p className="text-xs text-slate-500 font-mono">Ref {confirmed.payment_ref}</p>
          ) : null}
          {emailReceipt ? (
            <p className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800">
              <MailCheck size={16} className="shrink-0" aria-hidden />
              <span>{emailReceipt}</span>
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Booked for {confirmed.hours} {confirmed.hours === 1 ? 'hour' : 'hours'} (final · no refund). Show this at the desk when you arrive.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              setConfirmed(null)
              setEmailReceipt(null)
              setStep('pick')
            }}
          >
            Book another
          </button>
        </section>
      ) : null}

        {step === 'pay' && pending ? (
          <section className="enter-rise card p-4 space-y-4">
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
                {pending.court?.name ?? 'Court'} · {fmtDateTime(pending.start_at)} – {fmtTime(pending.end_at)}
              </p>
              <p className="text-sm text-slate-500">
                {pending.hours} {pending.hours === 1 ? 'hour' : 'hours'} · {peso(pending.amount)}
              </p>
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                Confirmed bookings are final (no refund).
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
              <AvailabilityLoading />
            ) : (
              <>
                <section className="enter-fade card p-3 space-y-3">
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

                <section className="enter-fade card p-3">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="label mb-0">Available times · {fmtDate(dateYmd + 'T12:00:00+08:00')}</p>
                    <p className="text-xs font-bold text-brand-700">{peso(total)}</p>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {(selectedCourt?.slots ?? []).map((s) => {
                      const ok = slotOk(s.startHour)
                      const isStart = startHour === s.startHour
                      const inSelectedRange =
                        startHour != null && s.startHour >= startHour && s.startHour < startHour + hours
                      const myBooking = myHoursOnCourt.get(s.startHour)
                      const isPast =
                        new Date(localRangeISO(dateYmd, s.startHour, 1).start_at).getTime() < Date.now() - 5 * 60000
                      const isBooked = !s.available && !isPast

                      return (
                        <button
                          key={s.startHour}
                          type="button"
                          disabled={!ok}
                          onClick={() => setStartHour(s.startHour)}
                          className={`rounded-xl min-h-12 px-2 py-1.5 text-sm font-bold border flex flex-col items-center justify-center leading-tight transition ${
                            isStart
                              ? 'bg-brand-700 text-white border-brand-700'
                              : inSelectedRange
                                ? 'bg-brand-50 text-brand-900 border-brand-500'
                                : ok
                                  ? 'bg-white border-slate-200 text-slate-800 hover:border-brand-300'
                                  : isBooked
                                    ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                                    : 'bg-slate-100 border-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <span>{hourLabel(s.startHour)}</span>
                          {myBooking ? (
                            <span className="text-[10px] font-semibold text-brand-800 mt-0.5">
                              Booked · {myBooking.hours}h
                            </span>
                          ) : isBooked ? (
                            <span className="text-[10px] font-semibold text-slate-500 mt-0.5">
                              Booked
                            </span>
                          ) : inSelectedRange && !isStart ? (
                            <span className="text-[10px] font-semibold text-brand-700 mt-0.5">
                              +{hours}h block
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                  {startHour != null ? (
                    <p className="mt-2.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-900">
                      Selected: {hourLabel(startHour)} – {hourLabel(startHour + hours)} ({hours}{' '}
                      {hours === 1 ? 'hour' : 'hours'}) · No refund once booked
                    </p>
                  ) : null}
                </section>

                {error ? <p className="text-sm text-red-600 font-medium">{error}</p> : null}

                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={startHour == null || busy || Boolean(user && (!isDemoMode || (isPlayerUser && !member)))}
                  aria-busy={busy}
                  onClick={() => void goPay()}
                >
                  {busy
                    ? 'Holding slot…'
                    : isDemoMode || !user
                      ? `Continue · ${peso(total)}`
                      : 'Ask the desk to reserve'}
                </button>
              </>
            )}

            {mine.length > 0 ? (
              <section className="card p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h2 className="font-extrabold">Your bookings</h2>
                  <span className="text-[11px] font-semibold text-slate-500">All bookings are non-refundable</span>
                </div>
                {mine.slice(0, 8).map((b) => {
                  const isBooked = b.status === 'confirmed'
                  const hoursLabel = `${b.hours} ${b.hours === 1 ? 'hour' : 'hours'}`
                  return (
                    <div key={b.id} className="list-row gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">
                          {b.court?.name ?? 'Court'} · {fmtDateTime(b.start_at)} – {fmtTime(b.end_at)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                          <span
                            className={`pill text-[11px] ${
                              isBooked
                                ? 'pill-ok'
                                : b.status === 'pending_payment'
                                  ? 'pill-warn'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isBooked ? `Booked · ${hoursLabel}` : `${b.status.replace('_', ' ')} · ${hoursLabel}`}
                          </span>
                          {isBooked ? (
                            <span className="text-[11px] font-semibold text-amber-800">No refund</span>
                          ) : null}
                          {b.payment_ref ? (
                            <span className="text-[11px] font-mono text-slate-400">{b.payment_ref}</span>
                          ) : null}
                        </div>
                      </div>
                      <p className="font-bold text-sm whitespace-nowrap">{peso(b.amount)}</p>
                    </div>
                  )
                })}
              </section>
            ) : null}
          </>
        ) : null}
    </>
  )

  if (routeClubSlug && !user) {
    return (
      <PublicFrame title={pageTitle} subtitle={pageSubtitle}>
        {content}
      </PublicFrame>
    )
  }

  return (
    <AppShell role={user?.role ?? 'member'}>
      <AppHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {content}
      </main>
    </AppShell>
  )
}
