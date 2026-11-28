import type { ReactNode } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Photo } from './Photo'
import { stagger } from '../lib/motion'
import { addonPriceLabel, amenityLabel, isSafeLink } from '../lib/clubProfile'
import type { PublicClubProfile } from '../types'
import { PLAIN_EMAIL, callName, clubContactLinks, pesoKeep } from '../lib/clubFormat'

/**
 * The parts of a club page that come from the club's business profile. Every
 * section hides itself when the club has not filled it in. Text the club wrote
 * is shown as plain text (line breaks kept), never as HTML, and links open only
 * when they are https.
 */

const linkButton = 'btn-compact'

function telHref(phone: string) {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`
}

function Card({ id, title, index, children }: { id: string; title: string; index: number; children: ReactNode }) {
  return (
    <section className="enter-rise card p-5 space-y-3" style={stagger(index)} aria-labelledby={id}>
      <h2 id={id} className="text-heading-3 font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

function ExternalButton({ href, children }: { href: string | null; children: ReactNode }) {
  if (!isSafeLink(href)) return null
  return (
    <a className={linkButton} href={href!} target="_blank" rel="noopener noreferrer">
      {children} <ExternalLink size={14} className="text-muted" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/**
 * The quickest ways to reach the club (call, email, Messenger), for the club page's side card
 * and for a club that has not listed its courts yet. Nothing shows when the club gave none.
 */
export function ClubContactLinks({ profile, title }: { profile: PublicClubProfile | null; title?: string }) {
  const links = clubContactLinks(profile)
  if (!links) return null
  const { phone, email, messenger } = links
  return (
    <div className="space-y-2">
      {title ? <h2 className="text-subtitle font-semibold text-ink">{title}</h2> : null}
      <div className="flex flex-wrap gap-2">
        {phone ? <a className={linkButton} href={telHref(phone)}>Call {phone}</a> : null}
        {email ? <a className={linkButton} href={`mailto:${email}`}>Email the club</a> : null}
        <ExternalButton href={messenger}>Messenger</ExternalButton>
      </div>
    </div>
  )
}

/** About, amenities, and how to reach the club. */
export function ClubAboutCard({ clubName, profile, index }: { clubName: string; profile: PublicClubProfile; index: number }) {
  const links = [profile.facebook_url, profile.messenger_url, profile.instagram_url, profile.website_url].filter(isSafeLink)
  const hasContact = !!profile.phone || (!!profile.email && PLAIN_EMAIL.test(profile.email)) || links.length > 0
  if (!profile.about && profile.amenities.length === 0 && !hasContact) return null
  return (
    <Card id="club-about" title={`About ${clubName}`} index={index}>
      {profile.about ? <p className="text-subtitle font-normal text-ink whitespace-pre-line">{profile.about}</p> : null}
      {profile.amenities.length ? (
        <div>
          <h3 className="text-subtitle font-semibold text-ink">Amenities</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.amenities.map((amenity) => (
              <li key={amenity} className="pill pill-brand">{amenityLabel(amenity)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasContact ? (
        <div>
          <h3 className="text-subtitle font-semibold text-ink">Contact the club</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.phone ? (
              <a className={linkButton} href={telHref(profile.phone)}>Call {profile.phone}</a>
            ) : null}
            {profile.email && PLAIN_EMAIL.test(profile.email) ? (
              <a className={linkButton} href={`mailto:${profile.email}`}>Email</a>
            ) : null}
            <ExternalButton href={profile.facebook_url}>Facebook page</ExternalButton>
            <ExternalButton href={profile.messenger_url}>Messenger</ExternalButton>
            <ExternalButton href={profile.instagram_url}>Instagram</ExternalButton>
            <ExternalButton href={profile.website_url}>Website</ExternalButton>
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
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:thin] focus-visible:outline focus-visible:outline-3 focus-visible:outline-brand-700"
        tabIndex={0}
        aria-label={`Photos of ${clubName}. Swipe or scroll to see more.`}
      >
        {profile.gallery.map((photo, photoIndex) => (
          <li key={photo.id} className="w-64 max-w-[80%] shrink-0 snap-start">
            <Photo
              src={photo.url}
              alt={photo.caption ?? `${clubName}, photo ${photoIndex + 1} of ${count}`}
              className="block aspect-[4/3] w-full rounded-[10px]"
              lazy
            />
            {photo.caption ? <p className="mt-1 text-subtitle font-normal text-muted">{photo.caption}</p> : null}
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
      <p className="text-subtitle font-normal text-muted">Ask at the desk when you arrive. Add-ons are paid at the club.</p>
      <ul className="divide-y divide-line">
        {profile.addons.map((addon) => (
          <li key={addon.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-subtitle font-semibold text-ink">{addon.name}</p>
              {addon.description ? <p className="text-subtitle font-normal text-muted">{addon.description}</p> : null}
            </div>
            <p className="shrink-0 text-subtitle font-semibold text-ink">{addonPriceLabel(addon.price, addon.unit)}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function ClubCoachesCard({ clubSlug, profile, index }: { clubSlug?: string; profile: PublicClubProfile; index: number }) {
  if (profile.coaches.length === 0) return null
  return (
    <Card id="club-coaches" title="Coaches" index={index}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {profile.coaches.map((coach) => (
          <li key={coach.id} className="rounded-[10px] border border-line p-4 space-y-2">
            <div className="flex items-center gap-3">
              {coach.photo_url ? (
                <Photo src={coach.photo_url} alt={`Photo of ${coach.full_name}`} className="h-16 w-16 shrink-0 rounded-full" lazy />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-100 text-subtitle font-semibold text-ink" aria-hidden>
                  {initials(coach.full_name)}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-subtitle font-semibold text-ink">{coach.full_name}</p>
                {coach.headline ? <p className="text-subtitle font-normal text-muted">{coach.headline}</p> : null}
                {coach.hourly_rate != null ? (
                  <p className="text-subtitle font-semibold text-ink">{coach.hourly_rate === 0 ? 'Free' : `${pesoKeep(coach.hourly_rate)} per hour`}</p>
                ) : null}
              </div>
            </div>
            {coach.bio ? <p className="text-subtitle font-normal text-ink whitespace-pre-line">{coach.bio}</p> : null}
            <div className="flex flex-wrap gap-2">
              {coach.contact_phone ? (
                <a className={linkButton} href={telHref(coach.contact_phone)}>
                  Call {callName(coach.full_name)}
                </a>
              ) : null}
              <ExternalButton href={coach.contact_url}>
                Contact {callName(coach.full_name)}
              </ExternalButton>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-subtitle font-normal text-muted">Arrange lessons with the coach or the club.</p>
        {clubSlug ? (
          <Link to={`/coaches?club=${encodeURIComponent(clubSlug)}`} className="btn-secondary sm:w-auto! sm:px-6">
            See lesson times
          </Link>
        ) : null}
      </div>
    </Card>
  )
}

/** How to pay the club directly. bRineLy does not take or check these payments. */
export function ClubPaymentCard({ clubName, profile, index }: { clubName: string; profile: PublicClubProfile; index: number }) {
  if (!profile.payment_note && profile.payment_methods.length === 0) return null
  return (
    <Card id="club-payment" title={`How to pay ${clubName}`} index={index}>
      {profile.payment_note ? <p className="text-subtitle font-normal text-ink whitespace-pre-line">{profile.payment_note}</p> : null}
      {profile.payment_methods.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {profile.payment_methods.map((method) => (
            <li key={method.id} className="rounded-[10px] border border-line p-4">
              <p className="text-subtitle font-semibold text-ink">{method.label}</p>
              {method.account_name ? <p className="text-subtitle font-normal text-ink">{method.account_name}</p> : null}
              {method.account_number ? <p className="text-subtitle font-semibold text-ink tabular-nums">{method.account_number}</p> : null}
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
      <p className="text-subtitle font-normal text-muted" role="note">
        You pay {clubName} directly. bRineLy does not receive or check this payment. Keep your receipt and show it at the desk.
      </p>
    </Card>
  )
}

function Policy({ title, text }: { title: string; text: string | null }) {
  if (!text) return null
  return (
    <details className="group rounded-[10px] border border-line">
      <summary className="control-feedback flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-subtitle font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="px-4 pb-4 text-subtitle font-normal text-ink whitespace-pre-line">{text}</p>
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
