import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, Check, Handshake, PhoneCall, QrCode, Smartphone, Store, Sun, Sunrise, Sunset, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CallDayPicker } from '../components/CallDayPicker'
import { Photo } from '../components/Photo'
import { PrivacyAcknowledgement } from '../components/PrivacyAcknowledgement'
import { PublicFrame } from '../components/PublicFrame'
import { api } from '../lib/api'
import { stagger } from '../lib/motion'
import {
  CALENDAR_WEEKDAYS,
  OWNER_CALL_TIMES,
  ownerCallDateRange,
  ownerCallProblem,
  ownerCallSummary,
  shortMonthOfYmd,
  weekdayOfYmd,
} from '../lib/ownerRequests'
import { OWNERS_PHOTO, stockSrc, stockSrcSet } from '../lib/stockPhotos'
import { PRIVACY_READ_FIRST_ERROR, usePrivacyGate } from '../lib/usePrivacyGate'
import { BOOKING_HOLD_MINUTES } from '../types'
import type { OwnerCallRequestInput, OwnerCallTime } from '../types'

/** Short proof points beside the headline: what a listed club gets, nothing more. */
const proofPoints = [
  'Your own club page with photos, hours and a map',
  'Players pay your GCash directly',
  'Staff confirm payments from their phone',
  'A TV board for your courts',
]

const benefits: { title: string; body: string; Icon: LucideIcon }[] = [
  {
    title: 'Your own club page',
    body: 'Your courts, rates, photos, opening hours and a map with directions, on one page players can find.',
    Icon: Store,
  },
  {
    title: 'GCash straight to you',
    body: 'Players pay your club’s own GCash QR and send the reference. The money goes to you, not through bRineLy.',
    Icon: QrCode,
  },
  {
    title: 'Confirm payments on your phone',
    body: `Your staff check the reference in your GCash and tap Payment received. Unpaid holds free up after ${BOOKING_HOLD_MINUTES} minutes.`,
    Icon: Smartphone,
  },
  {
    title: 'A TV board for your courts',
    body: 'Show the day’s court schedule on a screen at your venue, court by court.',
    Icon: Tv,
  },
]

const steps: { title: string; body: string; Icon: LucideIcon }[] = [
  { title: 'Ask us for a call', body: 'Tell us about your courts and pick a day and time that suits you.', Icon: PhoneCall },
  { title: 'We set up your club with you', body: 'On the call we agree the terms, then create your club page and courts.', Icon: Handshake },
  {
    title: 'Start taking bookings',
    body: 'Create your owner account with the email you gave us. You manage courts, rates, photos and opening hours yourself.',
    Icon: CalendarCheck,
  },
]

const timeIcons: Record<OwnerCallTime, LucideIcon> = { morning: Sunrise, afternoon: Sun, evening: Sunset }

const sectionHeading = 'text-heading-2 font-semibold text-ink'
/** Public-page buttons fill the width on phones and size to their words from small tablets up. */
const fitButton = 'sm:w-auto! sm:px-6'
const ownerAccountState = { mode: 'join', owner: true }

function emptyRequest(): OwnerCallRequestInput {
  return {
    full_name: '',
    club_name: '',
    city: '',
    court_count: 2,
    phone: '',
    email: '',
    preferred_date: ownerCallDateRange().min,
    preferred_time: 'morning',
    message: '',
  }
}

const OWNER_CONSENT_ERROR = 'Tick the box so we may contact you and confirm you have read the Privacy Notice.'

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'We could not send your request. Please try again.'
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The public "I own a court" page: what listing gives a club, how it works, and a request for a call. */
export function OwnersPage() {
  const [form, setForm] = useState<OwnerCallRequestInput>(emptyRequest)
  // Left empty by people; filled in by some automated form fillers.
  const [trap, setTrap] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<OwnerCallRequestInput | null>(null)
  const privacyGate = usePrivacyGate({
    onUnlock: () => {
      setError((current) => (current === PRIVACY_READ_FIRST_ERROR ? null : current))
    },
    onCheck: (checked) => {
      if (checked) {
        setError((current) =>
          current === OWNER_CONSENT_ERROR || current === PRIVACY_READ_FIRST_ERROR ? null : current,
        )
      }
    },
  })
  const callRef = useRef<HTMLDivElement>(null)
  const formHeadingRef = useRef<HTMLHeadingElement>(null)
  const thanksHeadingRef = useRef<HTMLHeadingElement>(null)
  const range = ownerCallDateRange()
  // The page can stay open past midnight, leaving the first default day behind the range.
  const dayInRange = form.preferred_date >= range.min && form.preferred_date <= range.max

  // The form is gone once it is sent, so focus moves to the thank-you note instead of the page top.
  useEffect(() => {
    if (!sent) return
    thanksHeadingRef.current?.focus({ preventScroll: true })
    callRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }, [sent])

  function update<K extends keyof OwnerCallRequestInput>(key: K, value: OwnerCallRequestInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  /** The hero button: bring the call form (or the thank-you note) into view and move focus there. */
  function goToCall() {
    callRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    ;(sent ? thanksHeadingRef : formHeadingRef).current?.focus({ preventScroll: true })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const fieldProblem = ownerCallProblem(form)
    if (fieldProblem) {
      setError(fieldProblem)
      return
    }
    const consentProblem = privacyGate.validate(OWNER_CONSENT_ERROR)
    if (consentProblem) {
      setError(consentProblem)
      return
    }
    setError(null)
    if (trap) {
      setSent(form)
      return
    }
    setBusy(true)
    try {
      await api.requestOwnerCall(form)
      setSent(form)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicFrame title="List your club" heading="none" accountLinks="login">
      {/* Hero. Phones: words, photo, proof points and buttons. Desktop: words left, photo right. */}
      <section
        aria-labelledby="owners-title"
        className="enter-rise grid grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:grid-rows-[auto_auto]"
      >
        <div className="min-w-0 space-y-3 lg:self-end">
          <p className="text-subtitle font-semibold text-brand-700">For court owners</p>
          <h1 id="owners-title" className="max-w-[18ch] text-balance text-display font-semibold text-ink lg:text-display-lg">
            Take court bookings online, paid straight to your GCash
          </h1>
          <p className="max-w-[44ch] text-pretty text-title font-normal text-muted">
            List your club on bRineLy. Players near you find your courts, book an open hour and pay your club directly.
          </p>
        </div>
        <Photo
          src={stockSrc(OWNERS_PHOTO, 'small')}
          srcSet={stockSrcSet(OWNERS_PHOTO)}
          sizes="(min-width: 1024px) 27rem, 100vw"
          alt={OWNERS_PHOTO.alt}
          className="block aspect-[5/2] w-full rounded-xl lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:aspect-square lg:self-center [&_img]:object-[center_20%]"
          priority
        />
        <div className="min-w-0 space-y-6 lg:self-start">
          <ul className="space-y-3">
            {proofPoints.map((point) => (
              <li key={point} className="flex items-start gap-3 text-subtitle text-ink">
                <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white">
                  <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} />
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          {/* Both buttons share one width (the longer label's), stacked, so neither looks like an afterthought. */}
          <div className="flex flex-col gap-3 sm:w-fit">
            <button type="button" className="btn-primary sm:px-6" onClick={goToCall}>
              <PhoneCall aria-hidden="true" className="h-5 w-5" />
              {sent ? 'See your call time' : 'Pick a time for a call'}
            </button>
            <Link to="/login" state={ownerAccountState} className="btn-secondary sm:px-6">
              Already set up? Create my owner account
            </Link>
          </div>
          <p className="max-w-[52ch] text-body text-muted">
            We call you on the day and at the time you pick, in Philippine time. You agree the terms on the call, before anything is set up.
          </p>
        </div>
      </section>

      <section aria-labelledby="owners-get" className="grid grid-cols-1 gap-6 pt-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-12 lg:pt-16">
        <div className="space-y-2">
          <h2 id="owners-get" className={sectionHeading}>What you get</h2>
          <p className="text-subtitle text-muted">
            You run your club from your own admin screens. bRineLy brings the players and keeps the bookings in order.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          {benefits.map((benefit, index) => (
            <li key={benefit.title} className="enter-rise flex gap-4 border-t border-line pt-5" style={stagger(index + 1)}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
                <benefit.Icon aria-hidden="true" className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3 className="text-title font-semibold text-ink">{benefit.title}</h3>
                <p className="mt-1 text-subtitle text-muted">{benefit.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="owners-how" className="space-y-5 pt-10 lg:pt-16">
        <h2 id="owners-how" className={sectionHeading}>How listing works</h2>
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="enter-rise card flex gap-4 p-5 md:flex-col" style={stagger(index + 1)}>
              {/* Phones: the number beside the words. From tablets up: number and picture above them. */}
              <div className="flex shrink-0 items-center justify-between gap-3 self-start md:self-auto">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-900 text-heading-3 font-semibold text-white">
                  {index + 1}
                </span>
                <step.Icon aria-hidden="true" className="hidden h-7 w-7 text-brand-700 md:block" />
              </div>
              <div className="min-w-0">
                <h3 className="text-title font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-subtitle text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div ref={callRef} className="grid scroll-mt-24 grid-cols-1 gap-6 pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:items-start lg:gap-10 lg:pt-16">
        <div className="min-w-0">
          {sent ? (
            <ThankYou request={sent} headingRef={thanksHeadingRef} />
          ) : (
            <form className="enter-rise card p-4 sm:p-6" onSubmit={(event) => void submit(event)} aria-labelledby="owners-form" noValidate>
              <h2 id="owners-form" ref={formHeadingRef} tabIndex={-1} className={`${sectionHeading} outline-none`}>
                Ask us for a call
              </h2>
              <p className="mt-1 text-subtitle text-muted">
                Tell us about your club and pick a time. Someone from the bRineLy team will call you.
              </p>

              <FormGroup number={1} title="About you">
                <div>
                  <label className="label" htmlFor="owner-name">Your name</label>
                  <input id="owner-name" className="input" value={form.full_name} onChange={(event) => update('full_name', event.target.value)}
                    autoComplete="name" maxLength={80} required />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="owner-phone">Mobile number (optional)</label>
                    <input id="owner-phone" className="input" type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)}
                      autoComplete="tel" placeholder="0917 123 4567" maxLength={24} aria-describedby="owner-contact-hint" />
                  </div>
                  <div>
                    <label className="label" htmlFor="owner-email">Email (optional)</label>
                    <input id="owner-email" className="input" type="email" value={form.email} onChange={(event) => update('email', event.target.value)}
                      autoComplete="email" placeholder="name@example.com" maxLength={254} aria-describedby="owner-contact-hint" />
                  </div>
                </div>
                <p id="owner-contact-hint" className="text-body text-muted">Give at least one, so we can reach you.</p>
              </FormGroup>

              <FormGroup number={2} title="Your club">
                <div>
                  <label className="label" htmlFor="owner-club">Club or venue name</label>
                  <input id="owner-club" className="input" value={form.club_name} onChange={(event) => update('club_name', event.target.value)}
                    autoComplete="organization" maxLength={120} required />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
                  <div>
                    <label className="label" htmlFor="owner-city">City</label>
                    <input id="owner-city" className="input" value={form.city} onChange={(event) => update('city', event.target.value)}
                      autoComplete="address-level2" maxLength={80} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="owner-courts">Number of courts</label>
                    <input id="owner-courts" className="input" type="number" inputMode="numeric" min={1} max={50}
                      value={Number.isFinite(form.court_count) ? form.court_count : ''}
                      onChange={(event) => update('court_count', event.target.value === '' ? Number.NaN : Number(event.target.value))} required />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="owner-message">Anything else we should know? (optional)</label>
                  <textarea id="owner-message" className="input min-h-24" rows={3} maxLength={1000} value={form.message}
                    onChange={(event) => update('message', event.target.value)} placeholder="Indoor or outdoor, opening hours, best number to call" />
                </div>
              </FormGroup>

              <FormGroup number={3} title="When should we call?">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start">
                  <CallDayPicker
                    className="-mx-2 sm:mx-0"
                    value={form.preferred_date}
                    onChange={(day) => update('preferred_date', day)}
                    min={range.min}
                    max={range.max}
                  />
                  <fieldset className="min-w-0">
                    <legend className="label">Time of day (Philippine time)</legend>
                    <div className="grid grid-cols-1 gap-2">
                      {OWNER_CALL_TIMES.map((option) => {
                        const Icon = timeIcons[option.value]
                        return (
                          <label key={option.value} className="choice-card">
                            <input type="radio" name="owner-time" className="sr-only" value={option.value}
                              checked={form.preferred_time === option.value} onChange={() => update('preferred_time', option.value)} />
                            <Icon aria-hidden="true" className="h-6 w-6 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-subtitle font-semibold">{option.label}</span>
                              <span className="choice-card-sub block text-body">{option.hours}</span>
                            </span>
                            <span aria-hidden="true" className="choice-card-mark">
                              <Check className="h-4 w-4" strokeWidth={3} />
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                </div>
                <p className="notice flex items-start gap-3 text-subtitle font-semibold" aria-live="polite">
                  <PhoneCall aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                  <span>{dayInRange ? ownerCallSummary(form.preferred_date, form.preferred_time) : 'Choose a day for the call.'}</span>
                </p>
              </FormGroup>

              <div aria-hidden="true" className="sr-only">
                <label>
                  Leave this empty
                  <input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(event) => setTrap(event.target.value)} />
                </label>
              </div>
              <div className="mt-6 space-y-4 border-t border-line pt-6">
                <PrivacyAcknowledgement
                  gate={privacyGate}
                  label="bRineLy may contact me about listing my club, and I have read and understood the Privacy Notice."
                />
                {error ? <p role="alert" className="notice notice-error text-body font-semibold">{error}</p> : null}
                <button type="submit" className={`btn-primary ${fitButton}`} disabled={busy} aria-busy={busy}>
                  {busy ? 'Sending…' : 'Ask for a call'}
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="lg:sticky lg:top-24" aria-labelledby="owners-account">
          <section className="card space-y-3 p-5">
            <h2 id="owners-account" className="text-title font-semibold text-ink">Already set up with us?</h2>
            <p className="text-subtitle text-muted">
              If we have set up your club, create your owner account with the email you gave us. You become your club’s admin, and you can log in as soon as your club is open.
            </p>
            <Link to="/login" state={ownerAccountState} className="btn-secondary">
              Create my owner account
            </Link>
          </section>
        </aside>
      </div>
    </PublicFrame>
  )
}

/** One numbered part of the call form, so it reads as three short steps instead of one long list. */
function FormGroup({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6 min-w-0 border-t border-line pt-6">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="mb-4 flex items-center gap-3 text-title font-semibold text-ink">
        <span className="step-num h-8! w-8! text-body!">{number}</span>
        {title}
      </p>
      <div className="space-y-4">{children}</div>
    </fieldset>
  )
}

/** The note shown once the request is sent: the chosen day and time, clearly, and what happens next. */
function ThankYou({ request, headingRef }: { request: OwnerCallRequestInput; headingRef: Ref<HTMLHeadingElement> }) {
  const TimeIcon = timeIcons[request.preferred_time]
  const contact = [request.phone.trim(), request.email.trim().toLowerCase()].filter(Boolean).join(' or ')
  return (
    <section className="enter-rise card space-y-5 p-5 sm:p-6" aria-labelledby="owners-sent" role="status">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-900 text-white">
          <Check aria-hidden="true" className="h-6 w-6" strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <h2 id="owners-sent" ref={headingRef} tabIndex={-1} className={`${sectionHeading} outline-none`}>
            Thank you, {request.full_name.trim().split(/\s+/)[0]}
          </h2>
          <p className="mt-1 text-subtitle text-muted">
            Your request to list <strong className="font-semibold text-ink">{request.club_name.trim()}</strong> is in.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-brand-50 p-4 sm:flex-row sm:items-center">
        <div aria-hidden="true" className="flex w-20 shrink-0 flex-col items-center overflow-hidden rounded-[10px] border border-line bg-white">
          <span className="w-full bg-brand-900 py-1 text-center text-body font-semibold text-white">{shortMonthOfYmd(request.preferred_date)}</span>
          <span className="pt-1 text-heading-2 font-semibold text-ink">{Number(request.preferred_date.slice(8))}</span>
          <span className="pb-1.5 text-body text-muted">{CALENDAR_WEEKDAYS[weekdayOfYmd(request.preferred_date)].short}</span>
        </div>
        <p className="flex min-w-0 items-start gap-3 text-title font-semibold text-ink">
          <TimeIcon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-brand-700" />
          <span>{ownerCallSummary(request.preferred_date, request.preferred_time)}</span>
        </p>
      </div>

      <p className="text-subtitle text-ink">
        We will use {contact}. If that time no longer suits you, just tell us when we call.
      </p>
      <p className="text-subtitle text-muted">
        On the call we agree the terms and set up your club with you. Then you create your owner account with the email you gave us.
      </p>
      <Link to="/" className={`btn-secondary ${fitButton}`}>Back to start</Link>
    </section>
  )
}
