import type { ReactNode } from 'react'
import { Camera, ExternalLink, Globe, Mail, MessageCircle, Phone, ScrollText, Users } from 'lucide-react'
import { Photo } from './Photo'
import { stagger } from '../lib/motion'
import { addonPriceLabel, amenityLabel, isSafeLink } from '../lib/clubProfile'
import type { PublicClubProfile } from '../types'
import { peso } from '../types'

/**
 * The parts of a club page that come from the club's business profile. Every
 * section hides itself when the club has not filled it in. Text the club wrote
 * is shown as plain text (line breaks kept), never as HTML, and links open only
 * when they are https.
 */

const linkButton =
  'control-feedback inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-slate-200 px-3 text-body font-semibold text-slate-800'

function telHref(phone: string) {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`
}

// Only a plain address becomes an email link, so a stored value can never add extra
// mail fields (such as ?bcc=) to the message it opens.
const PLAIN_EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

function Card({ id, title, index, children }: { id: string; title: string; index: number; children: ReactNode }) {
  return (
    <section className="enter-rise card p-4 space-y-3" style={stagger(index)} aria-labelledby={id}>
      <h2 id={id} className="text-title font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

function ExternalButton({ href, icon, children }: { href: string | null; icon: ReactNode; children: ReactNode }) {
  if (!isSafeLink(href)) return null
  return (
    <a className={linkButton} href={href!} target="_blank" rel="noopener noreferrer">
      {icon} {children} <ExternalLink size={14} className="text-slate-400" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/** About, amenities, and how to reach the club. */
export function ClubAboutCard({ clubName, profile, index }: { clubName: string; profile: PublicClubProfile; index: number }) {
  const links = [profile.facebook_url, profile.messenger_url, profile.instagram_url, profile.website_url].filter(isSafeLink)
  const hasContact = !!profile.phone || (!!profile.email && PLAIN_EMAIL.test(profile.email)) || links.length > 0
  if (!profile.about && profile.amenities.length === 0 && !hasContact) return null
  return (
    <Card id="club-about" title={`About ${clubName}`} index={index}>
      {profile.about ? <p className="text-body font-normal text-slate-700 whitespace-pre-line">{profile.about}</p> : null}
      {profile.amenities.length ? (
        <div>
          <h3 className="text-subtitle font-semibold text-slate-900">Amenities</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.amenities.map((amenity) => (
              <li key={amenity} className="pill pill-brand">{amenityLabel(amenity)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasContact ? (
        <div>
          <h3 className="text-subtitle font-semibold text-slate-900">Contact the club</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.phone ? (
              <a className={linkButton} href={telHref(profile.phone)}><Phone size={18} aria-hidden /> Call {profile.phone}</a>
            ) : null}
            {profile.email && PLAIN_EMAIL.test(profile.email) ? (
              <a className={linkButton} href={`mailto:${profile.email}`}><Mail size={18} aria-hidden /> Email</a>
            ) : null}
            <ExternalButton href={profile.facebook_url} icon={<Users size={18} aria-hidden />}>Facebook page</ExternalButton>
            <ExternalButton href={profile.messenger_url} icon={<MessageCircle size={18} aria-hidden />}>Messenger</ExternalButton>
            <ExternalButton href={profile.instagram_url} icon={<Camera size={18} aria-hidden />}>Instagram</ExternalButton>
            <ExternalButton href={profile.website_url} icon={<Globe size={18} aria-hidden />}>Website</ExternalButton>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

/** The club's own photos, in a row you can swipe. */
export function ClubGallery({ clubName, profile, index }: { clubName: string; profile: PublicClubProfile; index: number }) {
  if (profile.gallery.length === 0) return null
  const count = profile.gallery.length
  return (
    <Card id="club-gallery" title="Photos" index={index}>
      <ul
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:thin] focus-visible:outline focus-visible:outline-3 focus-visible:outline-brand-600"
        tabIndex={0}
        aria-label={`Photos of ${clubName}. Swipe or scroll to see more.`}
      >
        {profile.gallery.map((photo, photoIndex) => (
          <li key={photo.id} className="w-64 max-w-[80%] shrink-0 snap-start">
            <Photo
              src={photo.url}
              alt={photo.caption ?? `${clubName}, photo ${photoIndex + 1} of ${count}`}
              className="block aspect-[4/3] w-full rounded-xl"
              lazy
            />
            {photo.caption ? <p className="mt-1 text-body font-normal text-slate-600">{photo.caption}</p> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Extras the club rents or sells. Nothing is charged in the app: players pay at the club. */
export function ClubAddonsCard({ profile, index }: { profile: PublicClubProfile; index: number }) {
  if (profile.addons.length === 0) return null
  return (
    <Card id="club-addons" title="Add-ons" index={index}>
      <p className="text-body font-normal text-slate-600">Ask at the desk when you arrive. Add-ons are paid at the club.</p>
      <ul className="divide-y divide-slate-100">
        {profile.addons.map((addon) => (
          <li key={addon.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-subtitle font-semibold text-slate-900">{addon.name}</p>
              {addon.description ? <p className="text-body font-normal text-slate-600">{addon.description}</p> : null}
            </div>
            <p className="shrink-0 text-body font-semibold text-brand-800">{addonPriceLabel(addon.price, addon.unit)}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function ClubCoachesCard({ profile, index }: { profile: PublicClubProfile; index: number }) {
  if (profile.coaches.length === 0) return null
  return (
    <Card id="club-coaches" title="Coaches" index={index}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {profile.coaches.map((coach) => (
          <li key={coach.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-3">
              {coach.photo_url ? (
                <Photo src={coach.photo_url} alt={`Photo of ${coach.full_name}`} className="h-16 w-16 shrink-0 rounded-full" lazy />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-50 text-subtitle font-semibold text-brand-800" aria-hidden>
                  {initials(coach.full_name)}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-subtitle font-semibold text-slate-900">{coach.full_name}</p>
                {coach.headline ? <p className="text-body font-normal text-slate-600">{coach.headline}</p> : null}
                {coach.hourly_rate != null ? (
                  <p className="text-body font-semibold text-brand-800">{coach.hourly_rate === 0 ? 'Free' : `${peso(coach.hourly_rate)} per hour`}</p>
                ) : null}
              </div>
            </div>
            {coach.bio ? <p className="text-body font-normal text-slate-700 whitespace-pre-line">{coach.bio}</p> : null}
            <div className="flex flex-wrap gap-2">
              {coach.contact_phone ? (
                <a className={linkButton} href={telHref(coach.contact_phone)}>
                  <Phone size={18} aria-hidden /> Call {coach.full_name.split(' ')[0]}
                </a>
              ) : null}
              <ExternalButton href={coach.contact_url} icon={<MessageCircle size={18} aria-hidden />}>
                Contact {coach.full_name.split(' ')[0]}
              </ExternalButton>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-body font-normal text-slate-600">Arrange lessons with the coach or the club.</p>
    </Card>
  )
}

/** How to pay the club directly. bRineLy does not take or check these payments. */
export function ClubPaymentCard({ clubName, profile, index }: { clubName: string; profile: PublicClubProfile; index: number }) {
  if (!profile.payment_note && profile.payment_methods.length === 0) return null
  return (
    <Card id="club-payment" title={`How to pay ${clubName}`} index={index}>
      {profile.payment_note ? <p className="text-body font-normal text-slate-700 whitespace-pre-line">{profile.payment_note}</p> : null}
      {profile.payment_methods.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {profile.payment_methods.map((method) => (
            <li key={method.id} className="rounded-xl border border-slate-200 p-3">
              <p className="text-subtitle font-semibold text-slate-900">{method.label}</p>
              {method.account_name ? <p className="text-body font-normal text-slate-700">{method.account_name}</p> : null}
              {method.account_number ? <p className="text-body font-semibold text-slate-900 tabular-nums">{method.account_number}</p> : null}
              {method.qr_url ? (
                <Photo
                  src={method.qr_url}
                  alt={`${method.label} QR code for paying ${clubName}`}
                  className="mx-auto mt-2 block aspect-square w-full max-w-[16rem] rounded-lg bg-white"
                  fit="contain"
                  lazy
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-body font-normal text-slate-600" role="note">
        You pay {clubName} directly. bRineLy does not receive or check this payment. Keep your receipt and show it at the desk.
      </p>
    </Card>
  )
}

function Policy({ title, text }: { title: string; text: string | null }) {
  if (!text) return null
  return (
    <details className="rounded-xl border border-slate-200">
      <summary className="control-feedback flex min-h-12 cursor-pointer items-center gap-2 px-3 text-subtitle font-semibold text-slate-900">
        <ScrollText size={18} aria-hidden /> {title}
      </summary>
      <p className="px-3 pb-3 text-body font-normal text-slate-700 whitespace-pre-line">{text}</p>
    </details>
  )
}

/** House rules, cancellation and refunds, and terms: closed until tapped, so the page stays short. */
export function ClubPoliciesCard({ profile, index }: { profile: PublicClubProfile; index: number }) {
  if (!profile.house_rules && !profile.cancellation_policy && !profile.terms) return null
  return (
    <Card id="club-policies" title="Rules and terms" index={index}>
      <div className="space-y-2">
        <Policy title="House rules" text={profile.house_rules} />
        <Policy title="Cancellation and refunds" text={profile.cancellation_policy} />
        <Policy title="Terms and conditions" text={profile.terms} />
      </div>
    </Card>
  )
}
