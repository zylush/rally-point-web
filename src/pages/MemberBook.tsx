import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Copy,
  Hourglass,
  Loader2,
  Lock,
  MailCheck,
  Timer,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { BookingSteps, type BookingStep } from '../components/BookingSteps'
import { Photo } from '../components/Photo'
import { PublicFrame } from '../components/PublicFrame'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { homeFor } from '../lib/roleHome'
import LoginPage from './LoginPage'
import type {
  Booking,
  CheckoutPaymentMethod,
  CourtDayAvailability,
  CourtType,
  Member,
  Profile,
  TimeSlot,
  Venue,
} from '../types'
import {
  APP_TIME_ZONE,
  BOOKING_HOLD_MINUTES,
  CLUB_CLOSE_HOUR,
  CLUB_OPEN_HOUR,
  CONFIRM_PAYMENT_MINUTES,
  appHour,
  checkoutState,
  courtRateFor,
  courtTypeLabel,
  fmtDate,
  fmtDateTime,
  fmtTime,
  hasActiveMembership,
  hourLabel,
  peso,
  ymdLocal,
} from '../types'

const COURT_TYPE_CHOICES: { value: '' | CourtType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
]

/**
 * Only the courts of one type; every court for no type, or when no court here has a type
 * (the choice is hidden then).
 */
function courtsOfType(rows: CourtDayAvailability[], type: '' | CourtType) {
  if (!type || !rows.some((row) => row.court.court_type)) return rows
  return rows.filter((row) => row.court.court_type === type)
}

/**
 * A visitor's pick, kept in this browser tab while they sign in. Signing in can reload this
 * screen (the app switches to the club), so the pick is read back from here afterwards.
 */
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
    const parsed = JSON.parse(raw) as Partial<BookingIntent> | null
    if (!parsed || parsed.clubSlug !== slug) return null
    if (typeof parsed.dateYmd !== 'string' || typeof parsed.startHour !== 'number' || typeof parsed.hours !== 'number') return null
    return parsed as BookingIntent
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

/** Staff, admins of other clubs' desks and platform superadmins cannot book online. */
const NOT_A_PLAYER = 'Only player accounts can book courts online. Please sign in with a player account.'

/** The width (Tailwind's `lg`) from which the booking summary sits beside the times. */
const WIDE_QUERY = '(min-width: 1024px)'

function subscribeWide(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(WIDE_QUERY)
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}

/**
 * Whether the screen is wide enough for the summary column. Without matchMedia (old browsers,
 * tests) the summary column holds the Continue button, as it always did.
 */
function useWideScreen() {
  return useSyncExternalStore(
    subscribeWide,
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true),
    () => true,
  )
}

/**
 * The height of the app's bottom menu (0 where it is hidden, on wider screens or for visitors),
 * so the phone's Continue bar can sit just above it.
 */
function useBottomNavHeight(enabled: boolean) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const nav = document.querySelector<HTMLElement>('.bottom-nav')
    if (!nav) return
    const measure = () => setHeight(nav.offsetHeight)
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(nav)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [enabled])
  return enabled ? height : 0
}

/** "6:00–7:00 AM", or "11:00 AM–1:00 PM" when the hours cross noon. */
function compactRange(start: number, end: number) {
  const [startTime, startHalf] = hourLabel(start).split(' ')
  const [endTime, endHalf] = hourLabel(end).split(' ')
  return startHalf === endHalf ? `${startTime}–${endTime} ${endHalf}` : `${startTime} ${startHalf}–${endTime} ${endHalf}`
}

/** The parts of the day the time grid is grouped by, by start hour. */
const DAY_PARTS = [
  { id: 'early', name: 'Early morning', range: '12–4 AM', from: 0, to: 5 },
  { id: 'morning', name: 'Morning', range: '5–11 AM', from: 5, to: 12 },
  { id: 'afternoon', name: 'Afternoon', range: '12–4 PM', from: 12, to: 17 },
  { id: 'evening', name: 'Evening', range: '5–8 PM', from: 17, to: 21 },
  { id: 'night', name: 'Late night', range: '9–11 PM', from: 21, to: 24 },
] as const

type Step = 'pick' | 'pay' | 'waiting' | 'done'

/** How often the waiting screen asks whether the club has decided. */
const PAYMENT_CHECK_MS = 15000

/** A GCash reference, once the spaces GCash shows in it are taken out. */
const REFERENCE_PATTERN = /^[A-Za-z0-9]{6,30}$/

/** The club refused the reference itself (its format), so nothing was sent. */
const REFERENCE_REFUSED = /6 to 30 letters/i

const HOLD_RAN_OUT = `Your ${BOOKING_HOLD_MINUTES} minutes to pay ran out, so those hours were released. Pick a time again.`

/** A message above the times, and whether it should point to the player's notifications. */
type Notice = { text: string; notifications?: boolean }

/** A newer copy of a booking, keeping the court it was shown with. */
function withLatest(shown: Booking, latest: Booking): Booking {
  return { ...shown, ...latest, court: latest.court ?? shown.court }
}

function cleanReference(raw: string) {
  return raw.replace(/\s+/g, '')
}

/** What is wrong with a typed reference number, in plain words, or null when it looks right. */
function referenceProblem(reference: string, app: string) {
  if (!reference) return `Type the reference number ${app} showed you after you paid.`
  if (!REFERENCE_PATTERN.test(reference)) {
    return `That does not look like a ${app} reference number. It should be 6 to 30 letters or numbers, with no other symbols.`
  }
  return null
}

/** When the club should have checked a sent payment. */
function confirmDeadline(booking: Booking) {
  if (booking.confirm_by) return new Date(booking.confirm_by).getTime()
  const sentAt = booking.payment_submitted_at ? new Date(booking.payment_submitted_at).getTime() : Date.now()
  return sentAt + CONFIRM_PAYMENT_MINUTES * 60000
}

/** The status word a player sees for one of their bookings. */
function bookingStatusWord(booking: Booking) {
  if (booking.status === 'pending_payment') {
    const state = checkoutState(booking)
    if (state === 'awaiting_confirmation') return 'Waiting for the club to confirm'
    return state === 'released' ? 'Time to pay ran out' : 'Waiting for payment'
  }
  if (booking.status === 'confirmed') return 'Booked'
  const word = booking.status.replace('_', ' ')
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** "2:00 PM – 4:00 PM" for a booking's hours. */
function timeRange(booking: Pick<Booking, 'start_at' | 'end_at'>) {
  return `${fmtTime(booking.start_at)} – ${fmtTime(booking.end_at)}`
}

function hoursWord(hours: number) {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** The time now, updated every second, for the countdowns. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])
  return now
}

function minutesAndSeconds(ms: number) {
  const wholeSeconds = Math.ceil(ms / 1000)
  return { minutes: Math.floor(wholeSeconds / 60), seconds: wholeSeconds % 60 }
}

type SlotLook = { word: string; Icon: LucideIcon | null; tone: string; pickable: boolean }

/** An hour that is the player's own: paid and booked, or held while they pay or the club checks. */
type OwnHour = 'booked' | 'held'

const MUTED_TONE = 'border-line bg-canvas text-muted'

/**
 * What one hour of the time grid says. Every hour of a paid or held booking reads
 * "Booked", so a 2-hour booking shows as two booked hours. The player's own hours say so.
 */
function slotLook(slot: TimeSlot, opts: { selected: boolean; freeHours: number; wanted: number; own: OwnHour | null }): SlotLook {
  if (opts.own === 'booked') return { word: 'Booked · yours', Icon: CheckCircle2, tone: 'border-brand-700 bg-brand-100 text-brand-900', pickable: false }
  if (opts.own === 'held') return { word: 'Held for you', Icon: Hourglass, tone: 'border-amber-300 bg-amber-50 text-amber-950', pickable: false }
  if (slot.blocked === 'booked') return { word: 'Booked', Icon: Lock, tone: MUTED_TONE, pickable: false }
  if (slot.blocked === 'passed') return { word: 'Passed', Icon: Clock, tone: MUTED_TONE, pickable: false }
  if (slot.blocked === 'out_of_service') return { word: 'Out of service', Icon: Wrench, tone: MUTED_TONE, pickable: false }
  if (!slot.available) return { word: 'Unavailable', Icon: Ban, tone: MUTED_TONE, pickable: false }
  const pickable = opts.freeHours >= opts.wanted
  // The picked hours are solid navy with the sky "picked" bar, and still say "Selected" in words.
  if (opts.selected) return { word: 'Selected', Icon: Check, tone: 'picked-mark border-brand-900 bg-brand-900 text-white', pickable }
  // Free, but the next hours are taken or the day ends before the chosen length.
  if (!pickable) return { word: `Only ${opts.freeHours}h free`, Icon: null, tone: 'border-line bg-white text-muted', pickable }
  // A free hour shows only its time: a white button with a firm border reads as "tap me".
  return { word: '', Icon: null, tone: 'border-field bg-white text-ink', pickable }
}

/** How long the player has left to pay before the held hours are released. */
function HoldCountdown({ endsAt }: { endsAt: number }) {
  const now = useNow()
  const left = Math.max(0, endsAt - now)
  const { minutes, seconds } = minutesAndSeconds(left)
  const share = Math.min(1, left / (BOOKING_HOLD_MINUTES * 60000))
  const urgent = left <= 2 * 60000
  // Screen readers hear the time left at 5 minutes and at 1 minute, not every second.
  const minutesLeft = Math.ceil(left / 60000)
  const spoken = minutesLeft === 5 || minutesLeft === 1 ? `${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'} left to pay` : ''
  return (
    <div className={`rounded-xl border p-3 ${urgent ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-brand-200 bg-brand-50 text-brand-900'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-bold">
          <Timer size={18} aria-hidden /> Time left to pay
        </p>
        <p role="timer" aria-label={`${minutes} min ${seconds} sec left to pay`} className="text-2xl font-extrabold tabular-nums">
          {minutes}:{String(seconds).padStart(2, '0')}
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white" aria-hidden>
        <div className={`h-full rounded-full ${urgent ? 'bg-rose-600' : 'bg-brand-700'}`} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-2 text-sm">
        We hold these hours for {BOOKING_HOLD_MINUTES} minutes. If time runs out, they are released and you go back to the times.
      </p>
      <p className="sr-only" aria-live="polite">{spoken}</p>
    </div>
  )
}

/**
 * How long the club has left to check a sent payment. Once that time is up the hours
 * still stay held: the player may already have paid, and there are no refunds.
 */
function ConfirmCountdown({ endsAt }: { endsAt: number }) {
  const now = useNow()
  const left = Math.max(0, endsAt - now)
  if (left === 0) {
    return (
      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
        <p className="font-extrabold">The club is taking longer than usual.</p>
        <p className="mt-1 text-sm">
          Your hours stay held for you, so you do not need to pay again. We keep checking and will show the answer here.
        </p>
      </div>
    )
  }
  const { minutes, seconds } = minutesAndSeconds(left)
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-brand-900">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-bold">
          <Hourglass size={18} aria-hidden /> Club checks within
        </p>
        <p role="timer" aria-label={`${minutes} min ${seconds} sec left for the club to confirm`} className="text-2xl font-extrabold tabular-nums">
          {minutes}:{String(seconds).padStart(2, '0')}
        </p>
      </div>
      <p className="mt-2 text-sm">
        The club has {CONFIRM_PAYMENT_MINUTES} minutes to check your payment. Your hours stay held while you wait.
      </p>
    </div>
  )
}

/**
 * One way to pay the club: its QR code, account name and number. A QR picture that does not
 * load says what to do instead: send the amount to the number, or ask the desk for it.
 */
function PayMethodCard({ method, amount }: { method: CheckoutPaymentMethod; amount: number }) {
  const [qrFailed, setQrFailed] = useState<string | null>(null)
  const qrBroken = Boolean(method.qr_url) && qrFailed === method.qr_url
  // Copying the number saves typing it into the payment app; "Copied" shows for a few seconds.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = window.setTimeout(() => setCopyState('idle'), 4000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  async function copyNumber(number: string) {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('No clipboard')
      // Payment apps want the digits only.
      await navigator.clipboard.writeText(number.replace(/\s+/g, ''))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-line p-3">
      <p className="text-title font-extrabold text-ink">{method.label}</p>
      {method.qr_url ? (
        <Photo
          src={method.qr_url}
          alt={`${method.label} QR code to pay ${method.account_name ?? 'the club'}`}
          fit="contain"
          priority
          onError={() => setQrFailed(method.qr_url ?? null)}
          className="mx-auto aspect-square w-full max-w-72 rounded-lg border border-line bg-white"
        />
      ) : null}
      {qrBroken ? (
        <p className="notice notice-warn text-body font-semibold">
          {method.account_number
            ? `The QR code did not load. Send ${peso(amount)} to the number below.`
            : `The QR code did not load. Ask the desk for the club's ${method.label} number.`}
        </p>
      ) : null}
      {method.account_name || method.account_number ? (
        <dl className="space-y-2">
          {method.account_name ? (
            <div>
              <dt className="text-sm text-muted">Account name</dt>
              <dd className="text-subtitle font-bold text-ink">{method.account_name}</dd>
            </div>
          ) : null}
          {method.account_number ? (
            <div>
              <dt className="text-sm text-muted">Number to send to</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-heading-2 font-bold tabular-nums tracking-wide text-ink">{method.account_number}</span>
                <button
                  type="button"
                  className="btn-secondary w-auto! gap-2 px-4"
                  onClick={() => void copyNumber(method.account_number ?? '')}
                >
                  {copyState === 'copied' ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
                  {copyState === 'copied' ? 'Copied' : 'Copy number'}
                </button>
                <span role="status" className={copyState === 'failed' ? 'basis-full text-sm font-semibold text-red-700' : 'sr-only'}>
                  {copyState === 'copied'
                    ? 'Number copied.'
                    : copyState === 'failed'
                      ? 'Copying did not work on this phone. Type the number into the app instead.'
                      : ''}
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}

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
  const out: { ymd: string; label: string; name: string; date: string; month: string }[] = []
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const ymd = ymdLocal(new Date(now + i * 86400000))
    const noon = new Date(`${ymd}T12:00:00+08:00`)
    const part = (options: Intl.DateTimeFormatOptions) =>
      noon.toLocaleDateString('en-US', { ...options, timeZone: APP_TIME_ZONE })
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : part({ weekday: 'short', month: 'short', day: 'numeric' })
    // The day card shows the name ("Today", "Sat"), the date number and the month, one per line.
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : part({ weekday: 'short' })
    out.push({ ymd, label, name, date: part({ day: 'numeric' }), month: part({ month: 'short' }) })
  }
  return out
}

export function MemberBook() {
  const { user, activeClub, joinClub } = useAuth()
  // Opened from a club page (/clubs/:slug/book), visitors can look at the times before signing in.
  const { slug: routeClubSlug } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const days = useMemo(() => nextDays(7), [])
  // A pick saved before signing in. One for a day no longer shown is not carried on.
  const savedIntent = useMemo(() => {
    const intent = readBookingIntent(routeClubSlug)
    return intent && days.some((d) => d.ymd === intent.dateYmd) ? intent : null
  }, [routeClubSlug, days])
  const [dateYmd, setDateYmd] = useState(() => savedIntent?.dateYmd ?? days[0].ymd)
  const [clubName, setClubName] = useState<string | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])
  // A club page can open this screen on one of its venues and courts.
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
  // The club's ways to be paid (null while loading); a club without one cannot take checkouts.
  const [payMethods, setPayMethods] = useState<CheckoutPaymentMethod[] | null>(null)
  const [payMethodsFailed, setPayMethodsFailed] = useState(false)
  const [pending, setPending] = useState<Booking | null>(null)
  const [confirmed, setConfirmed] = useState<Booking | null>(null)
  // The emailed receipt for a booking the club has confirmed.
  const [emailReceipt, setEmailReceipt] = useState<{ bookingId: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // When the held hours are let go, and why the player was sent back from checkout.
  const [holdEnds, setHoldEnds] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // While the time to pay runs out, the app first asks whether a payment was sent after all.
  const [checkingHold, setCheckingHold] = useState(false)
  // A checkout being reopened from Your bookings.
  const [resumingId, setResumingId] = useState<string | null>(null)
  // The reference number the player types after paying, and when the club should have checked it.
  const [reference, setReference] = useState('')
  const [referenceError, setReferenceError] = useState<string | null>(null)
  const [confirmEnds, setConfirmEnds] = useState<number | null>(null)
  const referenceField = useRef<HTMLInputElement>(null)
  // Each checkout step's heading takes focus, so screen readers hear where the player is.
  const stepHeading = useRef<HTMLHeadingElement>(null)
  // A visitor who tapped Continue signs in here; the checkout starts once their account is ready.
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [autoCheckoutPending, setAutoCheckoutPending] = useState(() => Boolean(savedIntent?.autoCheckout))
  // The club this screen joined the player to (the app also switches to it).
  const [joinedClubSlug, setJoinedClubSlug] = useState<string | null>(null)
  // The club link names no club taking bookings, so there is nothing to choose from.
  const [clubMissing, setClubMissing] = useState(false)
  // The club's phone, read from its public profile once it turns down a payment.
  const [clubPhone, setClubPhone] = useState<string | null>(null)
  const availCacheRef = useRef<Map<string, CourtDayAvailability[]>>(new Map())
  // Which club, venue and day the times on screen are for.
  const [availFor, setAvailFor] = useState<string | null>(null)
  // When today has nothing left to book, the screen opens on the next day that has. A day the
  // player taps, or a pick saved before signing in, is never moved.
  const autoDateRef = useRef<'pending' | 'done'>(savedIntent ? 'done' : 'pending')
  const [autoMovedTo, setAutoMovedTo] = useState<string | null>(null)
  // Indoor or outdoor courts only, once the player picks one. The ref lets a newly loaded day
  // or venue choose its first court of that type.
  const [courtTypeFilter, setCourtTypeFilter] = useState<'' | CourtType>('')
  const courtTypeFilterRef = useRef<'' | CourtType>('')
  // "Change time" with a reference typed first asks whether the player has paid.
  const [confirmLeave, setConfirmLeave] = useState(false)
  const stayButton = useRef<HTMLButtonElement>(null)
  const wideScreen = useWideScreen()
  const [bootstrappedKey, setBootstrappedKey] = useState<string | null>(null)
  // Bookings whose confirmation email was already asked for, so each is sent once.
  const emailedRef = useRef<Set<string>>(new Set())

  // Members and admins book as players; staff and platform superadmins cannot book online.
  const isPlayerUser = Boolean(user && (user.role === 'member' || user.role === 'admin'))
  // Staff are told so as soon as the screen opens. A platform superadmin is told on Continue.
  const staffCannotBook = Boolean(user && !isPlayerUser && user.role !== 'superadmin')
  const clubPageSlug = routeClubSlug ?? activeClub?.slug ?? null
  const clubReady = !routeClubSlug || activeClub?.slug === routeClubSlug || joinedClubSlug === routeClubSlug
  const publicBrowsingMode = Boolean(routeClubSlug && (!isPlayerUser || !clubReady))
  const checkoutReady = isPlayerUser && clubReady
  const expectedBootstrapKey = routeClubSlug
    ? `${routeClubSlug}:${user?.id ?? 'guest'}:${activeClub?.club_id ?? 'none'}`
    : user?.id ?? 'none'

  async function loadPayMethods() {
    setPayMethodsFailed(false)
    try {
      setPayMethods(await api.checkoutPaymentMethods())
    } catch {
      setPayMethods(null)
      setPayMethodsFailed(true)
    }
  }

  // The club's ways to pay are read once the player is signed in and in this club.
  useEffect(() => {
    if (checkoutReady) void loadPayMethods()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, checkoutReady])

  useEffect(() => {
    if (step !== 'pick') stepHeading.current?.focus()
  }, [step])

  /** Shows a booking's hours as taken in the grid and in the saved days, without asking again. */
  function markSlotsBookedInState(booking: Booking) {
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
                  ? { ...slot, available: false, blocked: 'booked' as const }
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
  }

  // Load club/venue/member context once per user or club context change.
  useEffect(() => {
    if (!routeClubSlug && !user) return
    let active = true
    setLoading(true)
    setError(null)
    setClubMissing(false)
    availCacheRef.current.clear()
    void (async () => {
      try {
        let joinedName: string | null = null
        if (routeClubSlug) {
          const needsJoin = isPlayerUser && activeClub?.slug !== routeClubSlug
          if (!isPlayerUser || (needsJoin && typeof joinClub !== 'function')) {
            // Visitors (and accounts that cannot book) see the club's public times.
            const detail = typeof api.publicClubDetail === 'function' ? await api.publicClubDetail(routeClubSlug) : null
            if (!active) return
            if (!detail) {
              setClubMissing(true)
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
          if (needsJoin) {
            // A player booking at another club joins it as a player, and the app switches to it.
            const joined = await joinClub(routeClubSlug, { asPlayer: true })
            if (!active) return
            joinedName = joined?.name ?? null
            setJoinedClubSlug(routeClubSlug)
          }
        }

        if (!user) return
        const [m, accessibleVenues] = await Promise.all([
          api.memberForUser(user.id),
          typeof api.listVenues === 'function' ? api.listVenues(user.id, user.role) : Promise.resolve([] as Venue[]),
        ])
        if (!active) return
        setClubName((current) => joinedName ?? activeClub?.name ?? current)
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
          // A pick saved before signing in cannot carry on here, so it is not kept for later.
          clearBookingIntent()
          setAutoCheckoutPending(false)
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

  const availKey = `${routeClubSlug ?? activeClub?.slug ?? 'default'}:${venueId}:${dateYmd}`
  const loadAvailability = useCallback(async (forceRefresh = false) => {
    if (bootstrappedKey !== expectedBootstrapKey) return
    const cacheKey = `${routeClubSlug ?? activeClub?.slug ?? 'default'}:${venueId}:${dateYmd}`
    const pickCourtId = (rows: CourtDayAvailability[]) => {
      const pool = courtsOfType(rows, courtTypeFilterRef.current)
      setCourtId((current) => {
        if (current && pool.some((row) => row.court.id === current && row.court.status !== 'maintenance')) return current
        const firstBookable = pool.find((row) => row.court.status !== 'maintenance') ?? pool[0]
        return firstBookable?.court.id ?? null
      })
    }
    if (!forceRefresh) {
      const cached = availCacheRef.current.get(cacheKey)
      if (cached) {
        setAvail(cached)
        setAvailFor(cacheKey)
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
      setAvailFor(cacheKey)
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

  async function reloadMine() {
    if (!user || !member || publicBrowsingMode) return
    try {
      setMine(await api.myBookings(member.id, venueId || undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bookings')
    }
  }

  /** Asks again for the day's times and the player's bookings, after hours were taken or let go. */
  async function refreshAfterChange() {
    await Promise.all([loadAvailability(true), reloadMine()])
  }

  /**
   * Emails the receipt once the club has confirmed a booking. Each booking is sent once, and
   * a failure never undoes the booking.
   */
  async function sendConfirmationEmail(done: Booking) {
    if (!user?.email || emailedRef.current.has(done.id)) return
    emailedRef.current.add(done.id)
    if (typeof api.sendBookingConfirmationEmail !== 'function') return
    try {
      const venueObj = venues.find((v) => v.id === (done.venue_id ?? venueId))
      const receipt = await api.sendBookingConfirmationEmail({
        // The receipt shows the GCash reference the player sent.
        booking: { ...done, payment_ref: done.payment_ref ?? done.payment_reference ?? null },
        clubName: clubName ?? activeClub?.name ?? 'bRineLy',
        venueName: venueObj?.name,
        recipientEmail: user.email,
      })
      if (receipt?.sent && receipt.preview) setEmailReceipt({ bookingId: done.id, text: receipt.preview })
    } catch {
      // Email receipt failures never roll back a confirmed booking.
    }
  }

  /** Back to the times, letting go of the hours held for checkout. */
  async function leaveCheckout(bookingId: string, message: string | null) {
    setConfirmLeave(false)
    setStep('pick')
    setPending(null)
    setHoldEnds(null)
    setNotice(message ? { text: message } : null)
    // Time ran out: start the pick again. Back keeps the pick so the player can carry on.
    if (message) setStartHour(null)
    // If this fails, the hold still lapses by itself when its time is up.
    await api.releaseBookingHold(bookingId).catch(() => undefined)
    await refreshAfterChange()
  }

  /** The waiting screen for a payment the player has sent; the club's time to check ends at `endsAt`. */
  function openWaiting(sent: Booking, endsAt: number) {
    // From here the hold no longer runs out; the club has its own time to check.
    setHoldEnds(null)
    setConfirmLeave(false)
    setPending(sent)
    setConfirmEnds(endsAt)
    setReference('')
    setReferenceError(null)
    setError(null)
    setNotice(null)
    setStep('waiting')
  }

  /**
   * The time to pay ran out on this phone. A payment the club got anyway (say, the reply to
   * "I've paid" was lost) still counts, so ask first; if that cannot be checked, let the hours go.
   */
  async function holdRanOut(held: Booking) {
    setCheckingHold(true)
    const latest = await api.myBooking(held.id).catch(() => null)
    setCheckingHold(false)
    if (latest?.payment_submitted_at) {
      const sent = withLatest(held, latest)
      openWaiting(sent, confirmDeadline(sent))
      return
    }
    await leaveCheckout(held.id, HOLD_RAN_OUT)
  }

  // When the time to pay runs out, the hours are released and the player goes back to the times.
  // A payment already under way is left to finish.
  useEffect(() => {
    if (step !== 'pay' || !pending || holdEnds == null || busy || checkingHold) return
    const held = pending
    const timer = window.setTimeout(() => void holdRanOut(held), Math.max(0, holdEnds - Date.now()))
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pending, holdEnds, busy, checkingHold])

  // While the club checks a sent payment, ask whether it has decided: once at the start (it may
  // have decided while the player was away), then every few seconds. A sent payment is never
  // released by the clock, so this keeps going until the club answers.
  const waitingId = step === 'waiting' ? pending?.id ?? null : null
  useEffect(() => {
    if (!waitingId || !pending) return
    const sent = pending
    let active = true
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const latest = await api.myBooking(waitingId)
        if (!active || !latest) return
        const state = checkoutState(latest)
        if (state === 'booked') {
          active = false
          const done = withLatest(sent, latest)
          setConfirmed(done)
          setStep('done')
          setPending(null)
          setConfirmEnds(null)
          setStartHour(null)
          // The hours now read as the player's own booking, without asking for the day again.
          setMine((prev) => [done, ...prev.filter((item) => item.id !== done.id)])
          markSlotsBookedInState(done)
          await sendConfirmationEmail(done)
        } else if (state === 'released') {
          active = false
          const ref = latest.payment_reference ?? sent.payment_reference
          setStep('pick')
          setPending(null)
          setConfirmEnds(null)
          setStartHour(null)
          // The player may want to ring the club; its phone is on its public profile, if it lists one.
          // Clear any number from an earlier rejection, which may have been at another club.
          setClubPhone(null)
          if (clubPageSlug && typeof api.publicClubProfile === 'function') {
            void api.publicClubProfile(clubPageSlug)
              .then((profile) => setClubPhone(profile?.phone?.trim() || null))
              .catch(() => setClubPhone(null))
          }
          // The club's reason is in the player's notifications; the hours may have gone for another reason too.
          setNotice({
            text:
              `The club did not confirm your payment${ref ? ` with reference ${ref}` : ''}, so those hours were released. ` +
              'Check your notifications for the club’s reason. If you did pay, show your GCash receipt at the desk.',
            notifications: true,
          })
          await refreshAfterChange()
        }
      } catch {
        // Try again at the next check.
      } finally {
        checking = false
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), PAYMENT_CHECK_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingId])

  const selectedCourt = avail.find((c) => c.court.id === courtId)
  // Members with an active membership pay the court's member rate; players pay the regular rate.
  const rate = selectedCourt ? courtRateFor(selectedCourt.court, member) : 0
  const isMember = hasActiveMembership(member)
  const total = rate * hours

  // The player's own booked or held hours on the chosen court and day, so the grid says they are theirs.
  const myHoursOnCourt = useMemo(() => {
    const map = new Map<number, OwnHour>()
    if (!courtId) return map
    for (const b of mine) {
      if (b.court_id !== courtId) continue
      if (ymdLocal(new Date(b.start_at)) !== dateYmd) continue
      const state = checkoutState(b)
      const own: OwnHour | null = state === 'booked'
        ? 'booked'
        : state === 'holding' || state === 'awaiting_confirmation'
          ? 'held'
          : null
      if (!own) continue
      const start = appHour(b.start_at)
      for (let i = 0; i < b.hours; i++) map.set(start + i, own)
    }
    return map
  }, [mine, courtId, dateYmd])

  /** Free hours in a row from `h`, counted up to `cap` (the picked length by default). */
  const freeHoursFrom = (h: number, cap = hours) => {
    let run = 0
    while (
      run < cap
      && h + run < CLUB_CLOSE_HOUR
      && !myHoursOnCourt.has(h + run)
      && selectedCourt?.slots.find((s) => s.startHour === h + run)?.available
    ) run++
    return run
  }
  // A start time stops counting once its hours are taken (say, after a reload).
  const selectionOk = startHour != null && freeHoursFrom(startHour) === hours
  const selectionLabel = selectionOk
    ? `${hourLabel(startHour)} – ${hourLabel(startHour + hours)} · ${hoursWord(hours)}`
    : 'Tap the hours you want'

  /**
   * The player builds a booking by tapping hours, as on other court apps: the hours picked are the length.
   * There is no maximum. A booking is one court and whole hours in a row (what the hold accepts), so:
   * tapping the free hour just before or after the pick adds it; tapping an end hour of the pick removes it;
   * tapping any other free hour starts a new pick there.
   */
  const pickSlot = (h: number) => {
    setNotice(null)
    if (startHour == null || !selectionOk) {
      setStartHour(h)
      setHours(1)
      return
    }
    const end = startHour + hours - 1
    if (h >= startHour && h <= end) {
      if (hours === 1) {
        setStartHour(null)
      } else if (h === startHour) {
        setStartHour(startHour + 1)
        setHours(hours - 1)
      } else {
        // The last hour, or the middle of three: keep the hours before it.
        setHours(h - startHour)
      }
      return
    }
    const adjacent = h === startHour - 1 || h === end + 1
    if (adjacent) {
      if (h < startHour) setStartHour(h)
      setHours(hours + 1)
      return
    }
    setStartHour(h)
    setHours(1)
  }
  // The app players pay with: the club's one method, or GCash when it has several.
  const payApp = payMethods?.length === 1 ? payMethods[0].label : 'GCash'
  const hasQr = payMethods?.some((m) => m.qr_url) ?? false
  const hasNumber = payMethods?.some((m) => m.account_number) ?? false
  const payStepOne = hasQr
    ? `Open ${payApp} and scan the QR code${hasNumber ? ', or send the money to the number shown' : ''}.`
    : hasNumber
      ? `Open ${payApp} and send the money to the number shown.`
      : `Open ${payApp} and pay the club's account shown below.`
  const courtNameOf = (b: Booking) => b.court?.name ?? avail.find((row) => row.court.id === b.court_id)?.court.name ?? 'Court'
  // A signed-in player needs their club record and the club's ways to pay before checking out.
  // Visitors can tap Continue: they sign in first, and the hold starts only after that.
  const continueBlocked = isPlayerUser && !publicBrowsingMode && (!member || !payMethods)

  /** Holds the picked hours for BOOKING_HOLD_MINUTES and opens the pay step. */
  async function startCheckout(activeUser: Profile, activeMember: Member) {
    if (!courtId || startHour == null || !payMethods?.length) return
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
      // Counted on this phone from when the hold came back, not from the server's time, so a
      // phone clock that runs fast cannot cut the minutes short.
      setHoldEnds(Date.now() + BOOKING_HOLD_MINUTES * 60000)
      setNotice(null)
      setReference('')
      setReferenceError(null)
      setConfirmLeave(false)
      setStep('pay')
    } catch (e) {
      clearBookingIntent()
      const message = e instanceof Error ? e.message : 'Could not hold slot'
      // Reloading clears messages, so show this one after it.
      await refreshAfterChange()
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function goPay() {
    if (!courtId || startHour == null || !selectionOk) return
    setError(null)

    if (!user) {
      // Visitors sign in first. The pick is kept, and the 15-minute hold starts once they are signed in.
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
      setError(NOT_A_PLAYER)
      return
    }

    if (!member) return
    await startCheckout(user, member)
  }

  function handleDialogAuthenticated(profile: Profile) {
    setAuthDialogOpen(false)
    if (profile.role !== 'member' && profile.role !== 'admin') {
      clearBookingIntent()
      setError(NOT_A_PLAYER)
      return
    }
    // Signing in can switch clubs and reload this screen, so the checkout starts from the effect
    // below, in whichever copy of the screen is showing once the account is ready.
    setAutoCheckoutPending(true)
  }

  // After signing in from this screen: once the player is in this club and its ways to pay are
  // known, carry on into checkout with the saved pick. This runs once.
  useEffect(() => {
    if (!autoCheckoutPending || !user) return
    if (!isPlayerUser) {
      setAutoCheckoutPending(false)
      clearBookingIntent()
      setError(NOT_A_PLAYER)
      return
    }
    if (!clubReady || bootstrappedKey !== expectedBootstrapKey) return
    if (!member) {
      setAutoCheckoutPending(false)
      clearBookingIntent()
      setError('Your club player profile is not ready yet. Please try again.')
      return
    }
    // Still finding out how this club is paid.
    if (payMethods == null && !payMethodsFailed) return
    setAutoCheckoutPending(false)
    clearBookingIntent()
    // Without a way to pay there is no checkout; the screen says why and keeps the pick.
    if (payMethods?.length) void startCheckout(user, member)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckoutPending, user, isPlayerUser, clubReady, bootstrappedKey, expectedBootstrapKey, member, payMethods, payMethodsFailed])

  /** The player says they paid: send the reference so the club can check it. */
  async function submitPayment(event: FormEvent) {
    event.preventDefault()
    if (!pending || busy || checkingHold) return
    const cleaned = cleanReference(reference)
    const problem = referenceProblem(cleaned, payApp)
    setReferenceError(problem)
    if (problem) {
      referenceField.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const sent = await api.submitBookingPayment({ booking_id: pending.id, reference: cleaned })
      const waiting = { ...withLatest(pending, sent), payment_reference: sent.payment_reference ?? cleaned }
      // The club's time is counted on this phone from the reply, like the time to pay.
      openWaiting(waiting, Date.now() + CONFIRM_PAYMENT_MINUTES * 60000)
    } catch (e) {
      const message = e instanceof Error && e.message
        ? e.message
        : 'Could not send your reference number. Check your connection and try again.'
      // Unless the reference itself was refused, the club may have it anyway: the reply can be
      // lost on a weak connection, or it was sent before. Ask before showing the error.
      if (!REFERENCE_REFUSED.test(message)) {
        const latest = await api.myBooking(pending.id).catch(() => null)
        if (latest?.payment_submitted_at) {
          const sentBooking = withLatest(pending, latest)
          openWaiting(sentBooking, confirmDeadline(sentBooking))
          return
        }
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Reopen a checkout from Your bookings, as it stands now: pay for hours still held, or wait
   * for the club to check a payment already sent. Only one checkout shows at a time.
   */
  async function resumeCheckout(listed: Booking) {
    if (busy || resumingId) return
    setResumingId(listed.id)
    setError(null)
    // undefined: could not check, so go on with what the list showed. null: the booking is gone.
    const latest = await api.myBooking(listed.id).catch(() => undefined)
    setResumingId(null)
    const current = latest ? withLatest(listed, latest) : listed
    if (latest !== null && checkoutState(current) === 'holding' && current.hold_expires_at) {
      setPending(current)
      // The hold started on another visit, so only the server's time is known here.
      setHoldEnds(new Date(current.hold_expires_at).getTime())
      setReference('')
      setReferenceError(null)
      setConfirmLeave(false)
      setNotice(null)
      // The grid's pick has nothing to do with this checkout.
      setStartHour(null)
      setStep('pay')
    } else if (latest !== null && current.payment_submitted_at) {
      // Sent: the waiting screen checks at once and shows the club's answer.
      openWaiting(current, confirmDeadline(current))
    } else {
      setStartHour(null)
      setNotice({ text: 'Those hours are no longer held for you, so there is nothing to pay. Pick a time again.' })
      await refreshAfterChange()
    }
  }

  const pageTitle = clubName ? `Book at ${clubName}` : 'Book a court'
  const currentStep: BookingStep = step === 'done'
    ? 'confirmed'
    : step === 'pick'
      ? authDialogOpen ? 'login' : 'choose'
      : 'pay'
  const homeLink = homeFor(user?.role ?? 'member')
  // Players and members have no home screen of their own: their way on is Find a court.
  const homeLabel = homeLink === '/clubs' ? 'Find another court' : 'Go to my home'
  const summaryClubName = clubName ?? activeClub?.name ?? null
  const dateLabel = fmtDate(`${dateYmd}T12:00:00+08:00`)
  // The times are in for this club and day, so an empty or closed list means just that.
  const availabilityReady = !loading && bootstrappedKey === expectedBootstrapKey
  const bookableRows = avail.filter((row) => row.court.status !== 'maintenance')
  const noCourts = availabilityReady && !error && avail.length === 0
  const allOutOfService = availabilityReady && avail.length > 0 && bookableRows.length === 0
  // Every court that is open is full (or past) for the chosen day.
  const dayFull = bookableRows.length > 0 && bookableRows.every((row) =>
    row.slots.every((slot) => !slot.available || (row.court.id === courtId && myHoursOnCourt.has(slot.startHour))),
  )
  // Today's hours that are already over are folded into one line, so the grid starts at the
  // first hour someone could still book instead of a wall of "Passed".
  const courtSlots = selectedCourt?.slots ?? []
  const firstNotPassed = courtSlots.findIndex((slot) => slot.blocked !== 'passed')
  const passedBefore = firstNotPassed === -1 ? courtSlots.length : firstNotPassed
  const shownSlots = courtSlots.slice(passedBefore)
  const everyHourPassed = passedBefore > 0 && shownSlots.length === 0
  const dayIndex = days.findIndex((d) => d.ymd === dateYmd)
  const nextDay = dayIndex >= 0 ? days[dayIndex + 1] ?? null : null
  // The indoor/outdoor choice shows only when a court here has a type.
  const hasCourtTypes = avail.some((row) => row.court.court_type)
  const shownCourts = courtsOfType(avail, courtTypeFilter)
  const typeFilter = hasCourtTypes ? courtTypeFilter : ''
  const noShownCourtOpen = Boolean(typeFilter) && !shownCourts.some((row) => row.court.status !== 'maintenance')

  /** Shows only indoor or outdoor courts (or all again), moving the pick to a court that is shown. */
  function chooseCourtType(type: '' | CourtType) {
    courtTypeFilterRef.current = type
    setCourtTypeFilter(type)
    const pool = courtsOfType(avail, type)
    if (pool.some((row) => row.court.id === courtId && row.court.status !== 'maintenance')) return
    setCourtId(pool.find((row) => row.court.status !== 'maintenance')?.court.id ?? null)
    setNotice(null)
    setStartHour(null)
  }

  /** Shows another day's times, starting the pick again. */
  function chooseDay(ymd: string) {
    autoDateRef.current = 'done'
    setAutoMovedTo(null)
    setDateYmd(ymd)
    setNotice(null)
    setStartHour(null)
  }

  // Today with nothing left to book (every hour over or taken) opens on the next day with a free
  // hour. If no day this week has one, the screen stays on today and says so.
  useEffect(() => {
    if (autoDateRef.current !== 'pending' || step !== 'pick') return
    if (!availabilityReady || availFor !== availKey) return
    const open = avail.filter((row) => row.court.status !== 'maintenance')
    const nothingFree = open.length > 0 && open.every((row) => row.slots.every((slot) => !slot.available))
    if (error || !nothingFree || dayIndex < 0) {
      autoDateRef.current = 'done'
      if (!error && !nothingFree && dayIndex > 0) setAutoMovedTo(dateYmd)
      return
    }
    if (dayIndex < days.length - 1) {
      setDateYmd(days[dayIndex + 1].ymd)
      return
    }
    autoDateRef.current = 'done'
    setDateYmd(days[0].ymd)
  }, [step, availabilityReady, availFor, availKey, avail, error, dayIndex, days, dateYmd])

  useEffect(() => {
    if (confirmLeave) stayButton.current?.focus()
  }, [confirmLeave])

  // Below `lg` the pick and Continue sit in a bar at the bottom of the screen; signed-in players
  // have the app's bottom menu there, so the bar sits on top of it.
  const inAppShell = Boolean(user) || !routeClubSlug
  const navHeight = useBottomNavHeight(inAppShell && !wideScreen)
  const showContinue = !staffCannotBook && !payMethodsFailed && !(payMethods && payMethods.length === 0)
  const continueDisabled = !selectionOk || busy || resumingId != null || continueBlocked
  const pickHint = !selectionOk && !busy ? 'Pick your hours to continue' : null
  const errorMessage = error && !(staffCannotBook && error === NOT_A_PLAYER)
    ? <p role="alert" className="text-sm text-red-700 font-semibold">{error}</p>
    : null
  const clubPageLink = clubPageSlug ? (
    <Link to={`/clubs/${clubPageSlug}`} className="text-link inline-flex min-h-12 items-center">
      Go to the club page
    </Link>
  ) : null

  // The log-in sheet repeats what the visitor picked, so they do not lose track mid-booking.
  const loginSummary = selectionOk && startHour != null && selectedCourt
    ? `${selectedCourt.court.name} · ${dateLabel} · ${hourLabel(startHour)}–${hourLabel(startHour + hours)} · ${peso(total)}`
    : undefined
  const backToClub = routeClubSlug && step === 'pick' && !clubMissing ? (
    <Link
      to={`/clubs/${routeClubSlug}`}
      className="control-feedback inline-flex min-h-12 items-center gap-1 text-body font-semibold text-brand-800"
    >
      <ChevronLeft size={18} aria-hidden /> Back to {clubName ?? 'club'}
    </Link>
  ) : null
  // Visitors get the link above the page title (PublicFrame `back`); signed-in players keep it in the page.
  const visitorFrame = Boolean(routeClubSlug && !user)

  const content: ReactNode = (
    <>
      {authDialogOpen ? (
        <LoginPage
          dialog
          bookingSummary={loginSummary}
          clubName={clubName ?? activeClub?.name}
          clubSlug={routeClubSlug ?? activeClub?.slug}
          onClose={() => {
            setAuthDialogOpen(false)
            setAutoCheckoutPending(false)
            clearBookingIntent()
          }}
          onAuthenticated={handleDialogAuthenticated}
        />
      ) : null}

      {clubMissing ? null : <BookingSteps current={currentStep} visitor={!user} />}

      {visitorFrame ? null : backToClub}

      {user && !member && !loading && !publicBrowsingMode ? (
        <section className="card p-4">
          <p className="font-bold">No membership linked</p>
          <p className="text-sm text-muted mt-1">
            Ask the desk to link your account to a member profile before booking online.
          </p>
        </section>
      ) : null}

      {step === 'done' && confirmed ? (
        <section className="enter-rise card p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-brand-700">
              <CheckCircle2 size={22} aria-hidden />
              <h2 ref={stepHeading} tabIndex={-1} className="outline-none font-extrabold text-lg">Booking confirmed</h2>
            </div>
            <span className="pill pill-ok">Booked · {hoursWord(confirmed.hours)}</span>
          </div>
          <p className="text-sm text-muted">
            {courtNameOf(confirmed)} · {fmtDateTime(confirmed.start_at)} – {fmtTime(confirmed.end_at)}
          </p>
          <p className="text-sm font-bold">{peso(confirmed.amount)}</p>
          <p className="text-sm text-ink">
            {confirmed.hours === 1 ? 'This hour now shows' : `These ${confirmed.hours} hours now show`} as Booked.
            No refunds.
          </p>
          {confirmed.payment_reference ?? confirmed.payment_ref ? (
            <p className="text-sm text-ink">
              GCash reference <span className="font-bold tabular-nums">{confirmed.payment_reference ?? confirmed.payment_ref}</span>
            </p>
          ) : null}
          {emailReceipt && emailReceipt.bookingId === confirmed.id ? (
            <p className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">
              <MailCheck size={18} className="shrink-0" aria-hidden />
              <span>{emailReceipt.text}</span>
            </p>
          ) : null}
          <p className="text-sm text-muted">Show this at the desk when you arrive.</p>
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
          <Link to={homeLink} className="text-link inline-flex min-h-12 items-center">
            {homeLabel}
          </Link>
        </section>
      ) : null}

      {step === 'pay' && pending ? (
        <section className="enter-rise card max-w-2xl p-4 space-y-4">
          {confirmLeave ? (
            <div role="group" aria-labelledby="leave-checkout-question" className="notice notice-warn space-y-3">
              <p id="leave-checkout-question" className="text-body font-semibold text-ink">
                These hours will be released. Only go back if you have not paid.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary w-auto! px-4"
                  onClick={() => void leaveCheckout(pending.id, null)}
                  disabled={busy || checkingHold}
                >
                  Release and change time
                </button>
                <button ref={stayButton} type="button" className="btn-primary w-auto! px-5" onClick={() => setConfirmLeave(false)}>
                  Stay here
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="min-h-12 text-body font-semibold text-brand-700 inline-flex items-center gap-1"
              onClick={() => {
                // Someone who typed a reference may already have paid, so ask before letting the hours go.
                if (cleanReference(reference)) setConfirmLeave(true)
                else void leaveCheckout(pending.id, null)
              }}
              disabled={busy || checkingHold}
            >
              <ChevronLeft size={18} aria-hidden /> Change time
            </button>
          )}
          <div>
            <p className="text-body font-semibold text-muted">Checkout</p>
            <h2 ref={stepHeading} tabIndex={-1} className="outline-none text-title font-semibold text-ink mt-0.5">
              {courtNameOf(pending)} · {fmtDateTime(pending.start_at)}
            </h2>
            <p className="text-sm text-muted">
              {timeRange(pending)} · {hoursWord(pending.hours)}
            </p>
          </div>

          <div className="rounded-xl border-2 border-line bg-canvas p-3">
            <p className="text-sm font-bold text-ink">Amount to pay</p>
            <p className="text-heading-1 font-extrabold tabular-nums text-ink">{peso(pending.amount)}</p>
          </div>

          {holdEnds != null ? <HoldCountdown endsAt={holdEnds} /> : null}

          <div className="space-y-3">
            <h3 className="text-title font-extrabold text-ink">How to pay</h3>
            <ol className="list-decimal space-y-2 pl-6 text-body text-ink marker:font-extrabold">
              <li>{payStepOne}</li>
              <li>
                Pay exactly <span className="font-extrabold">{peso(pending.amount)}</span>.
              </li>
              <li>Type the reference number {payApp} shows after you pay, then tap “I’ve paid”.</li>
            </ol>
            {(payMethods ?? []).map((m) => <PayMethodCard key={m.id} method={m} amount={pending.amount} />)}
          </div>

          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <span className="font-extrabold">No refunds.</span>{' '}
            Once the club confirms your payment, {pending.hours === 1 ? 'this hour is' : `these ${pending.hours} hours are`} booked for you.
            Bookings cannot be cancelled or refunded.
          </p>

          <form className="space-y-3" noValidate onSubmit={(event) => void submitPayment(event)}>
            <div>
              <label className="label" htmlFor="checkout-reference">{payApp} reference number</label>
              <input
                ref={referenceField}
                id="checkout-reference"
                className="input text-lg tabular-nums tracking-wide"
                value={reference}
                inputMode="numeric"
                placeholder="e.g. 1234 567 890123"
                onChange={(event) => {
                  setReference(event.target.value)
                  if (referenceError) setReferenceError(null)
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={60}
                aria-invalid={referenceError ? true : undefined}
                aria-describedby={referenceError ? 'checkout-reference-help checkout-reference-error' : 'checkout-reference-help'}
              />
              <p id="checkout-reference-help" className="mt-1 text-sm text-muted">
                It is on your receipt in {payApp}, often called “Ref No.” Spaces are fine.
              </p>
              {referenceError ? (
                <p id="checkout-reference-error" className="mt-1 text-sm font-semibold text-red-700">{referenceError}</p>
              ) : null}
            </div>

            {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}

            <button type="submit" className="btn-primary w-full" disabled={busy || checkingHold} aria-busy={busy}>
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="animate-spin" size={18} aria-hidden /> Sending…
                </span>
              ) : (
                'I’ve paid'
              )}
            </button>
          </form>
        </section>
      ) : null}

      {step === 'waiting' && pending ? (
        <section className="enter-rise card p-4 space-y-4">
          <div className="flex items-center gap-2 text-brand-800">
            <Hourglass size={22} aria-hidden />
            <h2 ref={stepHeading} tabIndex={-1} className="outline-none font-extrabold text-lg">Waiting for the club to confirm</h2>
          </div>
          <p className="text-body text-ink">
            The club is checking that your payment arrived. This screen updates by itself.
          </p>
          <div className="rounded-xl border-2 border-line p-3 space-y-1">
            <p className="font-bold text-ink">{courtNameOf(pending)} · {fmtDate(pending.start_at)}</p>
            <p className="text-sm text-ink">
              {timeRange(pending)} · {hoursWord(pending.hours)} · {peso(pending.amount)}
            </p>
          </div>
          {pending.payment_reference ? (
            <div>
              <p className="text-sm font-bold text-ink">Your reference number</p>
              <p className="text-heading-3 font-extrabold tabular-nums tracking-wide break-all text-ink">{pending.payment_reference}</p>
            </div>
          ) : null}
          {confirmEnds != null ? <ConfirmCountdown endsAt={confirmEnds} /> : null}
          <p className="text-sm text-muted">
            You can leave this screen. Your booking shows under Your bookings as “Waiting for the club to confirm”.
          </p>
          <div className="flex flex-wrap gap-x-6">
            <Link to={homeLink} className="text-link inline-flex min-h-12 items-center">
              {homeLabel}
            </Link>
            <Link to="/member/notifications" className="text-link inline-flex min-h-12 items-center">
              Open notifications
            </Link>
          </div>
        </section>
      ) : null}

      {step === 'pick' && clubMissing ? (
        <section className="card p-5 space-y-2">
          <h2 className="text-title font-semibold text-ink">This club is not taking bookings.</h2>
          <Link to="/clubs" className="text-link inline-flex min-h-12 items-center">
            See all clubs
          </Link>
        </section>
      ) : null}

      {step === 'pick' && !clubMissing ? (
        <>
          {notice ? (
            <section role="alert" className="notice notice-warn text-sm font-semibold text-amber-950">
              <p>{notice.text}</p>
              {notice.notifications ? (
                <div className="mt-1 flex flex-wrap gap-x-6">
                  <Link
                    to="/member/notifications"
                    className="inline-flex min-h-12 items-center font-extrabold text-amber-950 underline underline-offset-2"
                  >
                    Open your notifications
                  </Link>
                  {clubPhone ? (
                    <a
                      href={`tel:${clubPhone.replace(/[^\d+]/g, '')}`}
                      className="inline-flex min-h-12 items-center font-extrabold text-amber-950 underline underline-offset-2"
                    >
                      Call the club: {clubPhone}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {staffCannotBook ? (
            <p className="notice notice-warn text-body font-semibold">{NOT_A_PLAYER}</p>
          ) : null}
          <div className="px-1">
            <Link to="/clubs" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2">
              Book at another club
            </Link>
          </div>

          {noCourts ? (
            <section className="enter-fade card p-5 space-y-2">
              <h2 className="text-title font-semibold text-ink">This club has not listed courts yet.</h2>
              <div className="flex flex-wrap gap-x-6">
                {clubPageLink}
                <Link to="/clubs" className="text-link inline-flex min-h-12 items-center">
                  See all clubs
                </Link>
              </div>
            </section>
          ) : (
            <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:space-y-0">
              <div className="min-w-0 space-y-4">
                {venues.length > 1 ? (
                  <section className="card p-3">
                    <label className="label px-1" htmlFor="member-book-venue">Venue</label>
                    <select
                      id="member-book-venue"
                      className="input"
                      value={venueId}
                      onChange={(event) => {
                        autoDateRef.current = 'done'
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
                  {/* A row of calendar days: phones scroll it sideways, wider screens share the row out. */}
                  <div className="day-strip" role="group" aria-label="Date">
                    {days.map((d) => (
                      <button
                        key={d.ymd}
                        type="button"
                        aria-label={d.label}
                        aria-pressed={dateYmd === d.ymd}
                        onClick={() => chooseDay(d.ymd)}
                        className="day-card"
                      >
                        <span className="day-card-name" aria-hidden="true">{d.name}</span>
                        <span className="day-card-date" aria-hidden="true">{d.date}</span>
                        <span className="day-card-month" aria-hidden="true">{d.month}</span>
                      </button>
                    ))}
                  </div>
                  {autoMovedTo === dateYmd && dayIndex > 0 ? (
                    <p role="status" className="mt-2 px-1 text-body text-muted">
                      No open hours are left today, so this shows {dayIndex === 1 ? 'tomorrow' : days[dayIndex].label}.
                    </p>
                  ) : null}
                </section>

                {/* The booking summary, which normally shows errors, is hidden in these two states. */}
                {loading || allOutOfService ? errorMessage : null}

                {loading ? (
                  <AvailabilityLoading />
                ) : allOutOfService ? (
                  <section className="enter-fade card p-5 space-y-2">
                    <h2 className="text-title font-semibold text-ink">No courts are open for booking right now.</h2>
                    <p className="text-body text-muted">Every court here is out of service. Check back later or try another club.</p>
                    <div className="flex flex-wrap gap-x-6">
                      {clubPageLink}
                      <Link to="/clubs" className="text-link inline-flex min-h-12 items-center">
                        See all clubs
                      </Link>
                    </div>
                  </section>
                ) : (
                  <>
                    <section className="enter-fade card p-3 space-y-3">
                      <p className="label px-1">Court</p>
                      {hasCourtTypes ? (
                        <div role="group" aria-label="Indoor or outdoor courts" className="segmented">
                          {COURT_TYPE_CHOICES.map((choice) => (
                            <button
                              key={choice.value || 'all'}
                              type="button"
                              aria-pressed={typeFilter === choice.value}
                              onClick={() => chooseCourtType(choice.value)}
                            >
                              {choice.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {noShownCourtOpen ? (
                        <p role="status" className="px-1 text-body text-muted">
                          {shownCourts.length
                            ? `Every ${typeFilter} court here is out of service.`
                            : `No ${typeFilter} courts here.`}{' '}
                          Pick All to see every court.
                        </p>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        {shownCourts.map(({ court }) => {
                          const outOfService = court.status === 'maintenance'
                          const chosen = !outOfService && courtId === court.id
                          return (
                            <button
                              key={court.id}
                              type="button"
                              disabled={outOfService}
                              aria-pressed={outOfService ? undefined : chosen}
                              onClick={() => {
                                setCourtId(court.id)
                                setNotice(null)
                                setStartHour(null)
                              }}
                              className={`card relative min-h-14 px-3 py-3 text-left ${
                                outOfService
                                  ? 'bg-canvas! text-muted'
                                  : chosen
                                    ? 'border-brand-700! ring-1 ring-brand-700'
                                    : 'border-field!'
                              }`}
                            >
                              {chosen ? (
                                <Check size={18} className="absolute right-2 top-2 text-brand-700" aria-hidden />
                              ) : null}
                              <p className="pr-6 font-semibold text-ink">{court.name}</p>
                              {courtTypeLabel(court.court_type) ? (
                                <p className="text-body text-muted">{courtTypeLabel(court.court_type)}</p>
                              ) : null}
                              <p className={`text-body tabular-nums ${outOfService ? 'text-muted' : 'text-ink'}`}>
                                {outOfService ? 'Out of service' : `${peso(courtRateFor(court, member))}/hr`}
                              </p>
                              {!outOfService && !isMember && court.member_rate != null && court.member_rate < court.hourly_rate ? (
                                <p className="text-body tabular-nums text-brand-800">Members {peso(court.member_rate)}/hr</p>
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    </section>

                    <section className="enter-fade card p-3">
                      <p className="label px-1 mb-1">Available times · {dateLabel}</p>
                      <p className="px-1 text-body text-muted">
                        Tap each hour you want, in a row. Tap a picked hour at either end to remove it.
                      </p>
                      {everyHourPassed ? (
                        <p className="mt-2 px-1 text-body text-muted">
                          {`Every hour on ${dateLabel} has passed. Try another day.`}
                        </p>
                      ) : dayFull ? (
                        <p className="notice notice-warn mt-2 text-body font-semibold">
                          No free hours on {dateLabel}. Try another day.
                        </p>
                      ) : passedBefore > 0 ? (
                        <p className="mt-2 px-1 text-body text-muted">
                          {`Hours before ${hourLabel(shownSlots[0].startHour)} have passed.`}
                        </p>
                      ) : null}
                      {(everyHourPassed || dayFull) && nextDay ? (
                        <button type="button" className="btn-secondary mt-3 w-auto! px-5" onClick={() => chooseDay(nextDay.ymd)}>
                          {dayIndex === 0 ? 'See tomorrow' : `See ${nextDay.label}`}
                        </button>
                      ) : null}
                      {DAY_PARTS.map((part) => {
                        const partSlots = shownSlots.filter((slot) => slot.startHour >= part.from && slot.startHour < part.to)
                        if (partSlots.length === 0) return null
                        const headingId = `book-times-${part.id}`
                        return (
                          <div key={part.id} role="group" aria-labelledby={headingId} className="mt-3">
                            <h3 id={headingId} className="px-1 text-body font-semibold text-ink">
                              {part.name} <span className="font-normal text-muted">{part.range}</span>
                            </h3>
                            <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {partSlots.map((s) => {
                                const selected = selectionOk && s.startHour >= startHour && s.startHour < startHour + hours
                                const look = slotLook(s, {
                                  selected,
                                  // Any free hour can be tapped: the length comes from how many are picked.
                                  freeHours: freeHoursFrom(s.startHour, 1),
                                  wanted: 1,
                                  own: myHoursOnCourt.get(s.startHour) ?? null,
                                })
                                const face = (
                                  <>
                                    <span className="text-subtitle font-semibold tabular-nums">{hourLabel(s.startHour)}</span>
                                    {look.word ? (
                                      <span className="inline-flex items-center gap-1 text-sm">
                                        {look.Icon ? <look.Icon size={12} aria-hidden /> : null}
                                        {look.word}
                                      </span>
                                    ) : null}
                                  </>
                                )
                                const cellClass = `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center ${look.tone}`
                                // Hours that cannot start a booking are plain text, not faded buttons,
                                // so "Booked" stays easy to read.
                                return look.pickable ? (
                                  <button
                                    key={s.startHour}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => pickSlot(s.startHour)}
                                    className={cellClass}
                                  >
                                    {face}
                                  </button>
                                ) : (
                                  <div key={s.startHour} className={cellClass}>
                                    {face}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </section>
                  </>
                )}
              </div>

              {loading || allOutOfService ? null : (
                <aside aria-labelledby="booking-summary-title" className="enter-fade card p-4 space-y-3 lg:sticky lg:top-28">
                  <h2 id="booking-summary-title" className="text-title font-semibold text-ink">Your booking</h2>
                  <dl className="space-y-2 text-body">
                    {summaryClubName ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Club</dt>
                        <dd className="text-right font-semibold text-ink">{summaryClubName}</dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Court</dt>
                      <dd className="text-right font-semibold text-ink">{selectedCourt?.court.name ?? 'Choose a court'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Date</dt>
                      <dd className="text-right font-semibold text-ink">{dateLabel}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Time</dt>
                      <dd className="text-right font-semibold text-ink" aria-live={wideScreen ? 'polite' : undefined}>{selectionLabel}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-line pt-2">
                      <dt className="text-muted">Total</dt>
                      <dd className="text-right font-semibold tabular-nums text-ink">{peso(total)}</dd>
                    </div>
                  </dl>
                  <p className="text-body text-muted">
                    {isMember ? 'You pay the member rate where a court has one.' : 'You pay the regular rate. Members pay less where a court has a member rate.'}
                  </p>
                  {selectionOk ? (
                    <p className="text-sm font-semibold text-amber-900">No refund once booked.</p>
                  ) : null}

                  {/* On phones the error shows in the bottom bar, next to the Continue button that caused it. */}
                  {wideScreen || !showContinue ? errorMessage : null}

                  {staffCannotBook ? null : payMethodsFailed ? (
                    <section role="alert" className="notice notice-error">
                      <p className="font-semibold">We could not load how to pay this club.</p>
                      <p className="mt-1 text-sm">Check your connection, then try again.</p>
                      <button type="button" className="btn-secondary mt-3 w-full" onClick={() => void loadPayMethods()}>
                        Try again
                      </button>
                    </section>
                  ) : payMethods && payMethods.length === 0 ? (
                    <p className="notice notice-warn font-semibold">This club hasn&apos;t set up GCash payment yet. Ask the desk to reserve.</p>
                  ) : (
                    <>
                      {wideScreen ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary w-full"
                            disabled={continueDisabled}
                            aria-busy={busy}
                            aria-describedby={pickHint ? 'book-pick-hint' : undefined}
                            onClick={() => void goPay()}
                          >
                            {busy ? 'Holding slot…' : `Continue · ${peso(total)}`}
                          </button>
                          {pickHint ? (
                            <p id="book-pick-hint" className="px-1 text-body font-semibold text-ink">{pickHint}</p>
                          ) : null}
                        </>
                      ) : null}
                      {!user ? (
                        <p className="px-1 text-sm text-muted">
                          You log in before you pay. The {BOOKING_HOLD_MINUTES} minutes to pay start after that.
                        </p>
                      ) : null}
                    </>
                  )}
                </aside>
              )}

              {/* Phones: the pick and Continue stay in view at the bottom of the screen, above the
                  app's menu. The bar sticks within the times, so it never covers Your bookings. */}
              {!wideScreen && showContinue && !loading && !allOutOfService ? (
                <div
                  role="region"
                  aria-label="Your pick"
                  className={`sticky z-30 -mx-4 border-t border-line bg-white px-4 pt-3 md:-mx-6 md:px-6 ${
                    navHeight ? 'pb-3' : 'pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]'
                  }`}
                  style={{ bottom: navHeight }}
                >
                  {errorMessage ? <div className="mb-2">{errorMessage}</div> : null}
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1" aria-live="polite">
                      {selectionOk ? (
                        <>
                          <p className="truncate text-body text-muted">
                            {selectedCourt?.court.name ?? 'Court'} · {days[dayIndex]?.label ?? dateLabel}
                          </p>
                          <p className="text-subtitle font-semibold tabular-nums text-ink">
                            {compactRange(startHour, startHour + hours)} · {peso(total)}
                          </p>
                        </>
                      ) : (
                        <p id="book-pick-hint" className="text-body font-semibold text-ink">Pick your hours to continue</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-primary w-auto! shrink-0 px-6"
                      disabled={continueDisabled}
                      aria-busy={busy}
                      aria-describedby={selectionOk ? undefined : 'book-pick-hint'}
                      onClick={() => void goPay()}
                    >
                      {busy ? 'Holding slot…' : 'Continue'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {mine.length > 0 ? (
            <section className="card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">Your bookings</h2>
                <span className="text-sm font-semibold text-muted">All bookings are non-refundable</span>
              </div>
              {mine.slice(0, 8).map((b) => {
                // An online checkout left open (another visit, or a reload) can be picked up again.
                // Desk bookings have no hold time and are paid at the desk.
                const state = b.status === 'pending_payment' ? checkoutState(b) : null
                const canPay = state === 'holding' && Boolean(b.hold_expires_at) && Boolean(payMethods?.length)
                const canCheck = state === 'awaiting_confirmation'
                const titleId = `my-booking-${b.id}`
                const opening = resumingId === b.id
                const isBooked = b.status === 'confirmed'
                const ref = b.payment_reference ?? b.payment_ref
                const tone = isBooked
                  ? 'pill-ok'
                  : state === 'holding' || state === 'awaiting_confirmation'
                    ? 'pill-warn'
                    : 'pill-muted'
                return (
                  <div key={b.id} className="list-row flex-wrap gap-2">
                    <div className="min-w-0 flex-1">
                      <p id={titleId} className="font-semibold text-sm truncate">
                        {b.court?.name ?? 'Court'} · {fmtDateTime(b.start_at)} – {fmtTime(b.end_at)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        <span className={`pill ${tone}`}>{bookingStatusWord(b)}</span>
                        <span>{hoursWord(b.hours)}</span>
                        {isBooked ? <span className="font-semibold text-amber-900">No refund</span> : null}
                        {ref ? <span>Ref {ref}</span> : null}
                      </div>
                    </div>
                    <p className="font-bold text-sm whitespace-nowrap">{peso(b.amount)}</p>
                    {canPay || canCheck ? (
                      <button
                        type="button"
                        className={canPay ? 'btn-primary' : 'btn-secondary'}
                        aria-describedby={titleId}
                        disabled={busy || resumingId != null}
                        aria-busy={opening}
                        onClick={() => void resumeCheckout(b)}
                      >
                        {opening ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="animate-spin" size={18} aria-hidden /> Opening…
                          </span>
                        ) : canPay ? (
                          'Continue to pay'
                        ) : (
                          'Check status'
                        )}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </section>
          ) : null}
        </>
      ) : null}
    </>
  )

  if (visitorFrame) {
    return (
      <PublicFrame title={pageTitle} back={backToClub}>
        {content}
      </PublicFrame>
    )
  }

  return (
    <AppShell role={user?.role ?? 'member'}>
      <AppHeader title={pageTitle} right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {content}
      </main>
    </AppShell>
  )
}
