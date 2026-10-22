import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { PrivacyNoticeState } from '../lib/privacyNotice'
import { homeFor } from '../lib/roleHome'
import { DEFAULT_CLUB_SLUG } from '../lib/tenant'

// Gensan's support inbox is the only privacy contact supplied so far, so other
// clubs are pointed to their own staff instead.
const gensanPrivacyEmail = 'support@rallypointgensan.com'
const gensanName = 'Rally Point Gensan'

type NoticeClub = { isGensan: boolean; name: string | null }

function sections(club: NoticeClub): { title: string; content: ReactNode }[] {
  const clubLabel = club.name ?? 'your club'
  return [
    {
      title: 'Who we are',
      content: (
        <p>
          {club.isGensan
            ? 'Rally Point Gensan is the club and app name used in this notice.'
            : `${club.name ?? 'Your club'} is the club named in this notice, and Rally Point is the app it uses.`}{' '}
          The legal registered entity operating the service has not yet been confirmed here. This
          notice explains how information is handled when you use the Rally Point app and services.
        </p>
      ),
    },
    {
      title: 'Personal information we collect',
      content: (
        <>
          <p>Depending on how you use the app, we may collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Account details such as your name, email address, and optional phone number.</li>
            <li>Membership, booking, open-play, check-in, and support inquiry details.</li>
            <li>Payment and transaction records related to club services.</li>
          </ul>
          <p className="mt-2">
            Do not send sensitive personal information unless it is needed for a specific service
            and we explain why it is required.
          </p>
        </>
      ),
    },
    {
      title: 'Why we use information and lawful bases',
      content: (
        <>
          <p>
            We use information to create and manage accounts, provide memberships and bookings,
            support check-in and transactions, respond to questions, maintain the service, and
            meet legal requirements.
          </p>
          <p className="mt-2">
            Under the Philippine Data Privacy Act of 2012 (RA 10173), processing is based, as
            applicable, on your consent, steps you request before or to perform a service
            agreement, compliance with a legal obligation, or a legitimate interest that does
            not override your rights. If sensitive personal information is processed, we will
            rely on a basis permitted by the Act.
          </p>
        </>
      ),
    },
    {
      title: 'Sharing and service providers',
      content: (
        <p>
          We may share information with service providers that help operate the app, including
          Supabase for account and database services. The current payment journey uses simulated
          flows and is not a completed live payment integration. If a payment provider is
          connected, this notice should be updated with its name and the information shared.
          Information may also be disclosed when required by law. This is not a complete
          provider list; details may be updated as services are confirmed.
        </p>
      ),
    },
    {
      title: 'Retention and security',
      content: (
        <>
          <p>
            We keep personal information only for as long as needed for the purposes above and
            applicable legal or operational requirements. A specific retention schedule has not
            yet been set out in this notice.
          </p>
          <p className="mt-2">
            We aim to use reasonable organizational, physical, and technical safeguards to
            protect information from unauthorized access, use, or disclosure. No method of
            storage or transmission can be guaranteed completely secure. Demo-mode information
            is stored in your browser and is separate from live club records.
          </p>
        </>
      ),
    },
    {
      title: 'Your rights under RA 10173',
      content: (
        <>
          <p>Subject to legal conditions and exceptions, you may have the right to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Be informed about how your personal information is processed and access it.</li>
            <li>Object to processing, or request correction, erasure, or blocking.</li>
            <li>Request data portability where applicable.</li>
            <li>File a complaint with the National Privacy Commission and seek remedies provided by law.</li>
          </ul>
          <p className="mt-2">
            You may also withdraw consent where processing is based on consent. This does not
            affect processing already carried out lawfully.
          </p>
        </>
      ),
    },
    {
      title: 'Privacy contact',
      content: club.isGensan ? (
        <p>
          For a privacy question or request, email{' '}
          <a
            className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline"
            href={`mailto:${gensanPrivacyEmail}`}
          >
            {gensanPrivacyEmail}
          </a>
          . This is a temporary support contact and has not been confirmed as a dedicated
          Data Protection Officer contact.
        </p>
      ) : (
        <p>
          For a privacy question or request, ask the staff at {clubLabel}. A dedicated Data
          Protection Officer contact has not been confirmed yet.
        </p>
      ),
    },
  ]
}

/** The club this notice is for: the join link's club, the signed-in club, or the default club. */
function useNoticeClub(slug: string): NoticeClub {
  const { activeClub } = useAuth()
  const knownName =
    slug === DEFAULT_CLUB_SLUG ? gensanName : slug === activeClub?.slug ? activeClub.name : null
  const [lookedUp, setLookedUp] = useState<{ slug: string; name: string | null } | null>(null)

  useEffect(() => {
    if (knownName) return
    let cancelled = false
    api
      .publicClub(slug)
      .then((club) => {
        if (!cancelled) setLookedUp({ slug, name: club?.name ?? null })
      })
      .catch(() => {
        if (!cancelled) setLookedUp({ slug, name: null })
      })
    return () => {
      cancelled = true
    }
  }, [knownName, slug])

  return {
    isGensan: slug === DEFAULT_CLUB_SLUG,
    name: knownName ?? (lookedUp?.slug === slug ? lookedUp.name : null),
  }
}

/** Only same-app paths are followed, never another site. */
function safeReturnPath(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null
}

function backLabel(path: string) {
  if (path === '/login') return 'Back to login'
  if (path.startsWith('/join/')) return 'Back to sign-up'
  if (path.endsWith('/help')) return 'Back to Help'
  return 'Back'
}

export function PrivacyNoticePage() {
  const { user, activeClub } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const clubParam = params.get('club')
  const slug = clubParam ?? activeClub?.slug ?? DEFAULT_CLUB_SLUG
  const club = useNoticeClub(slug)

  const backTo =
    safeReturnPath((location.state as PrivacyNoticeState | null)?.from) ??
    (user ? homeFor(user.role) : clubParam ? `/join/${encodeURIComponent(clubParam)}` : '/login')

  const subtitle = club.isGensan
    ? 'For Rally Point Gensan app users'
    : club.name
      ? `For ${club.name} players on the Rally Point app`
      : 'For Rally Point app users'

  const content = (
    <main className="app-content-rail safe-bottom mx-auto w-full py-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline underline-offset-2"
          to={backTo}
        >
          {backLabel(backTo)}
        </Link>
        <header className="mt-4 border-b border-slate-200 pb-5">
          <h1 className="text-heading-1 font-extrabold tracking-tight text-slate-950">
            Privacy Notice
          </h1>
          <p className="mt-2 text-body text-slate-600">{subtitle}</p>
          <p className="mt-1 text-caption text-slate-500">
            Last updated: October 17, 2026
          </p>
        </header>

        <div className="mt-5 space-y-4">
          {sections(club).map(({ title, content: body }) => (
            <section
              key={title}
              aria-labelledby={`privacy-${title.toLowerCase().replaceAll(' ', '-')}`}
              className="card p-4 sm:p-5"
            >
              <h2
                id={`privacy-${title.toLowerCase().replaceAll(' ', '-')}`}
                className="text-title font-bold text-slate-900"
              >
                {title}
              </h2>
              <div className="mt-2 text-body leading-relaxed text-slate-700">{body}</div>
            </section>
          ))}
        </div>
      </div>
    </main>
  )

  // Signed-in players keep their menu; visitors see the page on its own.
  if (user) return <AppShell role={user.role}>{content}</AppShell>
  return <div className="app-shell app-shell-desktop">{content}</div>
}
