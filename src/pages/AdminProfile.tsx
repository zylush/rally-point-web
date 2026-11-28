import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { BackButton } from '../components/BackButton'
import { AppHeader, AppShell, ClosableToast, SignOutButton } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { AMENITIES, emptyClubProfile, normalizeProfile, profileProblem } from '../lib/clubProfile'
import { stagger } from '../lib/motion'
import type { AdminClubProfile, Amenity, ClubProfileFields } from '../types'
import { AddonsCard } from './AdminProfileAddons'
import { CoachesCard } from './AdminProfileCoaches'
import { SaveButton, SectionTitle, TextArea, TextField } from './AdminProfileFields'
import { GalleryCard } from './AdminProfileGallery'
import { PaymentCard } from './AdminProfilePayment'
import { UnusedPicturesCard } from './AdminProfileUnused'
import { linkStyle, sentence, type Notice, type Run } from './adminProfileShared'

const PUBLIC_SITE_URL = 'https://brinely.info'

function publicBookingUrl(slug: string) {
  return `${PUBLIC_SITE_URL}/#/clubs/${encodeURIComponent(slug)}/book`
}

/**
 * The club's business profile: what players see about the club on its public page.
 * Club admins only (the route is admin-only, and every save is checked again in the database).
 */
export function AdminProfile() {
  const { activeClub } = useAuth()
  const [data, setData] = useState<AdminClubProfile | null>(null)
  const [fields, setFields] = useState<ClubProfileFields>(emptyClubProfile)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Notice | null>(null)
  const saving = useRef(false)
  const bookingUrl = activeClub ? publicBookingUrl(activeClub.slug) : null

  // The first load fills the form.
  const load = useCallback(async () => {
    try {
      const next = await api.adminClubProfile()
      setData(next)
      setFields(next.profile)
      setLoadFailed(false)
    } catch (error) {
      setLoadFailed(true)
      setMessage({ text: error instanceof Error ? error.message : 'Could not load the business profile', tone: 'problem' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The message stays on screen while scrolling, so a "done" message clears itself after a
  // few seconds, like the other screens' messages. A problem stays until it is closed.
  useEffect(() => {
    if (message?.tone !== 'done') return
    const timer = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [message])

  // After each save only the lists are refreshed, so text being typed in another section is
  // never replaced. If the refresh fails, the screen stays as it is.
  async function refreshLists() {
    try {
      setData(await api.adminClubProfile())
      return true
    } catch {
      return false
    }
  }

  const run: Run = async (key, action, done) => {
    // One save at a time: a second one started meanwhile could finish in the wrong order.
    if (saving.current) {
      setMessage({ text: 'Wait for the last save to finish, then try again.', tone: 'problem' })
      return false
    }
    saving.current = true
    setBusy(key)
    setMessage(null)
    let ok = false
    let notice: Notice
    try {
      try {
        const note = await action()
        notice = { text: typeof note === 'string' ? `${sentence(done)} ${note}` : done, tone: 'done' }
        ok = true
      } catch (error) {
        notice = { text: error instanceof Error ? error.message : 'Could not save. Try again.', tone: 'problem' }
      }
      // Refresh after a failure too: part of a batch (several photos) may already be saved.
      if (!(await refreshLists())) {
        notice = { text: `${sentence(notice.text)} The lists could not be refreshed, so reload the page to see the latest.`, tone: 'problem' }
      }
      setMessage(notice)
    } finally {
      saving.current = false
      setBusy(null)
    }
    return ok
  }

  async function saveProfile(event: FormEvent, key: string) {
    event.preventDefault()
    const submitted = fields
    const clean = normalizeProfile(submitted)
    const problem = profileProblem(clean)
    if (problem) {
      setMessage({ text: problem, tone: 'problem' })
      return
    }
    if (await run(key, () => api.updateClubProfile(clean), 'Saved. Players see it on your club page now.')) {
      // Show the tidied text that was saved, unless the admin kept typing meanwhile.
      setFields((now) => (now === submitted ? clean : now))
    }
  }

  const set = <K extends keyof ClubProfileFields>(key: K) => (value: ClubProfileFields[K]) =>
    setFields((now) => ({ ...now, [key]: value }))

  async function copyBookingLink() {
    if (!bookingUrl) return
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this browser.')
      }
      await navigator.clipboard.writeText(bookingUrl)
      setMessage({ text: 'Booking link copied. Paste it on your social media page.', tone: 'done' })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Clipboard access was denied.'
      setMessage({ text: `Could not copy the booking link. ${reason}`, tone: 'problem' })
    }
  }

  return (
    <AppShell role="admin">
      <AppHeader title="Business profile" subtitle="What players see about your club" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-3 space-y-4">
        <div className="flex items-center gap-2">
          <BackButton />
          <p className="text-sm text-slate-500">{activeClub?.name ?? 'Your club'}</p>
        </div>

        <section className="card p-4 space-y-2">
          <p className="text-sm text-slate-700">
            Everything here shows on your public club page as soon as you save it. Courts, rates, locations and opening
            hours are on <Link to="/admin/venues" className="font-semibold text-brand-800 underline">Venues &amp; courts</Link>.
          </p>
          {activeClub ? (
            <Link to={`/clubs/${activeClub.slug}`} className={`${linkStyle} gap-1`}>
              See your club page <ExternalLink size={14} aria-hidden />
            </Link>
          ) : null}
        </section>

        {activeClub && bookingUrl ? (
          <section className="card p-4 space-y-3" aria-labelledby="share-booking-link">
            <div>
              <h2 id="share-booking-link" className="text-subtitle font-semibold text-slate-900">Share your booking link</h2>
              <p className="text-sm text-slate-600">Post this link on Facebook or other social media to take players straight to booking for {activeClub.name}.</p>
            </div>
            <label htmlFor="club-booking-link" className="label">Booking link</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="club-booking-link"
                className="input min-h-12 min-w-0 w-full flex-1 text-sm"
                type="url"
                readOnly
                value={bookingUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="btn-secondary min-h-12 sm:!w-auto sm:shrink-0" onClick={() => void copyBookingLink()}>
                Copy link
              </button>
            </div>
            <Link to={`/clubs/${activeClub.slug}/book`} className={`${linkStyle} gap-1`}>
              Open booking page <ExternalLink size={14} aria-hidden />
            </Link>
          </section>
        ) : null}

        {loading ? <ProfileLoading /> : loadFailed || !data ? (
          <section className="card p-4 space-y-3" role="alert">
            <p className="text-sm text-slate-700">The business profile could not be loaded. It may not be set up on this system yet.</p>
            <button type="button" className="btn-secondary" onClick={() => { setLoading(true); void load() }}>Try again</button>
          </section>
        ) : (
          <>
            <form className="enter-rise card p-4 space-y-3" style={stagger(0)} onSubmit={(event) => void saveProfile(event, 'details')} aria-labelledby="profile-details">
              <SectionTitle id="profile-details" hint="Your story, how to reach you, and what your place offers.">Business details</SectionTitle>
              <TextArea id="profile-about" label="About your club" value={fields.about} onChange={set('about')} max={1500} rows={5}
                placeholder="Who you are, your courts, and what makes your place special." />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <TextField id="profile-phone" label="Phone (optional)" value={fields.phone} onChange={set('phone')} type="tel" placeholder="0917 123 4567" max={24} />
                <TextField id="profile-email" label="Email (optional)" value={fields.email} onChange={set('email')} type="email" placeholder="hello@yourclub.ph" max={254} />
              </div>
              <TextField id="profile-facebook" label="Facebook page link (optional)" value={fields.facebook_url} onChange={set('facebook_url')} type="url"
                placeholder="https://facebook.com/yourclub" max={300} />
              <TextField id="profile-messenger" label="Messenger link (optional)" value={fields.messenger_url} onChange={set('messenger_url')} type="url"
                placeholder="https://m.me/yourclub" max={300} />
              <TextField id="profile-instagram" label="Instagram link (optional)" value={fields.instagram_url} onChange={set('instagram_url')} type="url"
                placeholder="https://instagram.com/yourclub" max={300} />
              <TextField id="profile-website" label="Website (optional)" value={fields.website_url} onChange={set('website_url')} type="url"
                placeholder="https://yourclub.ph" max={300} />
              <p className="text-xs text-slate-500">Links must start with https://. Copy them from your browser’s address bar.</p>
              <fieldset>
                <legend className="label">Amenities</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AMENITIES.map((amenity) => (
                    <label key={amenity.value} className="min-h-12 rounded-xl border border-slate-200 px-3 py-2 flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={fields.amenities.includes(amenity.value)}
                        onChange={(event) => set('amenities')(
                          event.target.checked
                            ? [...fields.amenities, amenity.value]
                            : fields.amenities.filter((value: Amenity) => value !== amenity.value),
                        )}
                      />
                      <span className="flex-1">{amenity.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <SaveButton busy={busy} name="details">Save business details</SaveButton>
            </form>

            <form className="enter-rise card p-4 space-y-3" style={stagger(1)} onSubmit={(event) => void saveProfile(event, 'rules')} aria-labelledby="profile-rules">
              <SectionTitle id="profile-rules" hint="Players can open these on your club page before they book.">Rules and terms</SectionTitle>
              <TextArea id="profile-house-rules" label="House rules" value={fields.house_rules} onChange={set('house_rules')} max={3000} rows={5}
                placeholder="Example: Wear non-marking shoes. Arrive 10 minutes early. No food on the courts." />
              <TextArea id="profile-cancellation" label="Cancellation and refunds" value={fields.cancellation_policy} onChange={set('cancellation_policy')} max={2000} rows={4}
                placeholder="Example: Cancel at least 24 hours ahead for a full refund." />
              <TextArea id="profile-terms" label="Terms and conditions" value={fields.terms} onChange={set('terms')} max={6000} rows={6} />
              <SaveButton busy={busy} name="rules">Save rules and terms</SaveButton>
            </form>

            <PaymentCard
              index={2}
              note={fields.payment_note}
              onNoteChange={set('payment_note')}
              onSaveNote={(event) => void saveProfile(event, 'payment-note')}
              methods={data.payment_methods}
              busy={busy}
              run={run}
            />
            <AddonsCard index={3} addons={data.addons} busy={busy} run={run} />
            <CoachesCard index={4} coaches={data.coaches} busy={busy} run={run} />
            <GalleryCard index={5} gallery={data.gallery} busy={busy} run={run} />
            <UnusedPicturesCard index={6} busy={busy} run={run} />
          </>
        )}
      </main>
      {message ? <ClosableToast text={message.text} problem={message.tone === 'problem'} onClose={() => setMessage(null)} /> : null}
    </AppShell>
  )
}

function ProfileLoading() {
  return (
    <LoadingShapes label="Loading the business profile…">
      <div className="space-y-4" aria-hidden>
        {[0, 1].map((key) => (
          <div key={key} className="card p-4 space-y-3">
            <SkeletonLine size="subtitle" className="w-1/2" />
            <SkeletonLine size="caption" className="w-3/4" />
            <SkeletonBlock className="h-28 w-full rounded-[14px]!" />
            <SkeletonBlock className="h-[54px] w-full rounded-[14px]!" />
            <SkeletonBlock className="h-[54px] w-full rounded-[16px]!" />
          </div>
        ))}
      </div>
    </LoadingShapes>
  )
}
