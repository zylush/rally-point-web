import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronLeft, PhoneCall, UserPlus } from 'lucide-react'
import { PublicFrame } from '../components/PublicFrame'
import { api } from '../lib/api'
import { stagger } from '../lib/motion'
import {
  OWNER_CALL_TIMES,
  callDayLabel,
  ownerCallDateRange,
  ownerCallProblem,
  ownerCallTimeLabel,
} from '../lib/ownerRequests'
import type { OwnerCallRequestInput } from '../types'

const textLink = 'control-feedback inline-flex min-h-12 items-center gap-1 text-body font-semibold text-brand-800'

const steps = [
  { title: 'Ask us for a call', body: 'Tell us about your courts and when we can call you.' },
  { title: 'We set up your club with you', body: 'On the call we agree the terms, then create your club page and courts.' },
  {
    title: 'Start taking bookings',
    body: 'Create your owner account with the email you gave us. You manage courts, rates, photos and opening hours yourself.',
  },
]

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

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'We could not send your request. Please try again.'
}

/** The public "I own a court" page: how listing works, and a request for a call. */
export function OwnersPage() {
  const [form, setForm] = useState<OwnerCallRequestInput>(emptyRequest)
  const [consent, setConsent] = useState(false)
  // Left empty by people; filled in by some automated form fillers.
  const [trap, setTrap] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<OwnerCallRequestInput | null>(null)
  const range = ownerCallDateRange()

  function update<K extends keyof OwnerCallRequestInput>(key: K, value: OwnerCallRequestInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = ownerCallProblem(form) ?? (consent ? null : 'Tick the box so we may contact you')
    if (problem) {
      setError(problem)
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
    <PublicFrame title="List your club" subtitle="For pickleball court owners" accountLinks="login">
      <Link to="/" className={textLink}>
        <ChevronLeft size={18} aria-hidden /> Back to start
      </Link>

      <section className="enter-rise card p-4 space-y-3" aria-labelledby="owners-how">
        <h2 id="owners-how" className="text-subtitle font-bold text-slate-900">Put your courts on bRineLy</h2>
        <p className="text-body text-slate-700">
          Players near you find your club, see your courts and rates, and book. You run your club from your own admin screens.
        </p>
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-700 text-body font-bold text-white" aria-hidden>
                {index + 1}
              </span>
              <span>
                <span className="block text-body font-bold text-slate-900">{step.title}</span>
                <span className="block text-body text-slate-600">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {sent ? (
        <section className="enter-rise card p-4 space-y-3" style={stagger(1)} aria-labelledby="owners-sent" role="status">
          <h2 id="owners-sent" className="flex items-center gap-2 text-subtitle font-bold text-slate-900">
            <CalendarClock size={22} className="text-brand-700" aria-hidden />
            Thank you, {sent.full_name.trim().split(/\s+/)[0]}
          </h2>
          <p className="text-body text-slate-700">
            We will call you on <strong>{callDayLabel(sent.preferred_date)}</strong>, {ownerCallTimeLabel(sent.preferred_time).toLowerCase()},
            to talk about listing <strong>{sent.club_name.trim()}</strong>.
          </p>
          <p className="text-body text-slate-600">
            We will use {[sent.phone.trim(), sent.email.trim().toLowerCase()].filter(Boolean).join(' or ')}. If that time no longer suits you, just tell us when we call.
          </p>
          <Link to="/" className="btn-secondary min-h-12 w-full">Back to start</Link>
        </section>
      ) : (
        <form className="enter-rise card p-4 space-y-3" style={stagger(1)} onSubmit={(event) => void submit(event)} aria-labelledby="owners-form" noValidate>
          <h2 id="owners-form" className="flex items-center gap-2 text-subtitle font-bold text-slate-900">
            <PhoneCall size={22} className="text-brand-700" aria-hidden />
            Ask us for a call
          </h2>
          <div>
            <label className="label" htmlFor="owner-name">Your name</label>
            <input id="owner-name" className="input" value={form.full_name} onChange={(event) => update('full_name', event.target.value)}
              autoComplete="name" maxLength={80} required />
          </div>
          <div>
            <label className="label" htmlFor="owner-club">Club or venue name</label>
            <input id="owner-club" className="input" value={form.club_name} onChange={(event) => update('club_name', event.target.value)}
              autoComplete="organization" maxLength={120} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <p id="owner-contact-hint" className="text-sm text-slate-600">Give at least one, so we can reach you.</p>
          <div>
            <label className="label" htmlFor="owner-day">Day for the call</label>
            <input id="owner-day" className="input" type="date" min={range.min} max={range.max} value={form.preferred_date}
              onChange={(event) => update('preferred_date', event.target.value)} required />
          </div>
          <fieldset>
            <legend className="label">Time of day (Philippine time)</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {OWNER_CALL_TIMES.map((option) => (
                <label key={option.value} className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-body">
                  <input type="radio" name="owner-time" className="h-5 w-5" value={option.value}
                    checked={form.preferred_time === option.value} onChange={() => update('preferred_time', option.value)} />
                  <span>
                    <span className="block font-semibold text-slate-900">{option.label}</span>
                    <span className="block text-sm text-slate-600">{option.hours}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="owner-message">Anything else we should know? (optional)</label>
            <textarea id="owner-message" className="input min-h-24" rows={3} maxLength={1000} value={form.message}
              onChange={(event) => update('message', event.target.value)} placeholder="Indoor or outdoor, opening hours, best number to call" />
          </div>
          <div aria-hidden="true" className="sr-only">
            <label>
              Leave this empty
              <input tabIndex={-1} autoComplete="off" name="website" value={trap} onChange={(event) => setTrap(event.target.value)} />
            </label>
          </div>
          <div>
            <label className="flex min-h-12 items-start gap-3 text-body text-slate-700">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>bRineLy may contact me about listing my club.</span>
            </label>
            <Link to="/privacy" state={{ from: '/owners' }} className={textLink}>
              Read the Privacy Notice
            </Link>
          </div>
          {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-body font-semibold text-red-800">{error}</p> : null}
          <button type="submit" className="btn-primary min-h-12 w-full" disabled={busy} aria-busy={busy}>
            {busy ? 'Sending…' : 'Ask for a call'}
          </button>
        </form>
      )}

      <section className="enter-rise card p-4 space-y-2" style={stagger(2)} aria-labelledby="owners-account">
        <h2 id="owners-account" className="flex items-center gap-2 text-subtitle font-bold text-slate-900">
          <UserPlus size={22} className="text-brand-700" aria-hidden />
          Already set up with us?
        </h2>
        <p className="text-body text-slate-600">
          If we have set up your club, create your owner account with the email you gave us. You become your club’s admin, and you can log in as soon as your club is open.
        </p>
        <Link to="/login" state={{ mode: 'join', owner: true }} className="btn-secondary min-h-12 w-full">
          Create my owner account
        </Link>
      </section>
    </PublicFrame>
  )
}
