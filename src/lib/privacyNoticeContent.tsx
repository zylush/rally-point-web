import type { ReactNode } from 'react'

// Provisional contact pending confirmation of its role by the bRineLy team.
const brinelyPrivacyEmail = 'admin@brinely.info'

export const PRIVACY_NOTICE_UPDATED = 'November 27, 2026'

export type NoticeClub = { isGensan: boolean; name: string | null }

export type PrivacyNoticeSection = { title: string; content: ReactNode }

/** Shared notice sections shown on `/privacy` and inside the inline onboarding reader. */
export function corePrivacyNoticeSections(club: NoticeClub): PrivacyNoticeSection[] {
  const clubLabel = club.name ?? 'your club'
  const portalContactLink = (
    <a
      className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline"
      href={`mailto:${brinelyPrivacyEmail}`}
    >
      {brinelyPrivacyEmail}
    </a>
  )

  return [
    {
      title: 'At a glance',
      content: (
        <>
          <p>Key points about how bRineLy handles your information:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>What we collect:</strong> Account details (including optional nickname and
              profile photo), club memberships and membership requests, court holds and bookings,
              open-play sign-ups, QR check-ins, match and tournament records, coaching lesson
              requests and messages, support inquiries, and court-owner listing requests.
            </li>
            <li>
              <strong>Direct-to-club payments:</strong> Court and membership payments go directly to
              the club (at the desk or through the club&apos;s GCash QR). bRineLy records the payment
              reference number you submit and club-confirmed charges, and does not collect or hold
              player funds.
            </li>
            <li>
              <strong>Player privacy and public play:</strong> Other players in the same club
              cannot view your private court bookings, check-ins, contact details, or charges, and
              court-booking TV schedule views never display player names. Public club leaderboards,
              tournament brackets, and leaderboard or tournament TV views display participating
              players&apos; names, nicknames, profile photos, and match scores.
            </li>
            <li>
              <strong>Essential browser storage only:</strong> The app uses browser storage for
              sign-in sessions, active club memory, offline QR check-in pass caching (cleared on
              sign-out), and temporary booking or coaching state, with no advertising cookies or
              third-party trackers.
            </li>
            <li>
              <strong>Your rights under RA 10173:</strong> You can update your full name,
              nickname, and profile photo in Account, and ask to access, correct, object to, erase,
              block, or port your personal information, or contact the National Privacy Commission.
            </li>
          </ul>
        </>
      ),
    },
    {
      title: 'Who we are and club responsibilities',
      content: (
        <>
          <p>
            {club.isGensan
              ? 'bRineLy operates this booking portal for pickleball clubs and players in the Philippines.'
              : `${club.name ?? 'Your club'} is the club named in this notice, and bRineLy operates the booking portal it uses.`}{' '}
            bRineLy is used by multiple independent clubs:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>bRineLy</strong> operates the portal software and manages user accounts,
              sign-in security, court-owner call requests and invitations, audited read-only club
              support views, and platform commission records.
            </li>
            <li>
              <strong>Each participating club</strong> manages its own player memberships,
              membership approvals, court schedules, leaderboards and tournaments, direct-to-club
              payment confirmations, front-desk walk-ins and check-ins, linked coaches, support
              inquiries, and public club page content.
            </li>
          </ul>
          <p className="mt-2">
            Formal registered entity names and final Personal Information Controller (PIC) and
            Personal Information Processor (PIP) designations between bRineLy and participating
            clubs remain pending confirmation before official legal sign-off.
          </p>
        </>
      ),
    },
    {
      title: 'Personal information we collect',
      content: (
        <>
          <p>Depending on how you use the app, we may collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Account and sign-in details:</strong> Your full name, email address, optional
              phone number, optional nickname, optional profile photo (stored in the public{' '}
              <code>member-photos</code> bucket under an unguessable file link), 6-digit email
              verification status, and—for an owner account—the email address used for an owner
              invitation and whether that invitation was claimed or cancelled. Sign-in and sign-up
              rate limits store only short-lived SHA-256 hashes, never raw email addresses or
              passwords.
            </li>
            <li>
              <strong>Club memberships, bookings, and desk records:</strong> Member ID code
              (starting with <code>BR-</code> or <code>RP-</code>), membership plan and expiry or
              player-only status, club membership and renewal requests (including approved plan,
              recorded amount, or decline reason), court holds and bookings, open-play sign-ups, QR
              identifiers and check-in times, walk-in guest names and phone numbers entered at the
              front desk, staff or admin operational notes, and support inquiry subjects, messages,
              and replies. Booking a court or requesting a coach at a club you have not joined yet
              automatically registers you as a player at that club so its staff and coaches can
              handle your request.
            </li>
            <li>
              <strong>Leaderboards and tournament records:</strong> Singles and doubles match
              pairings, tournament registrations and seeded teams, court assignments, match scores,
              win/loss standings, and match notes or void reasons recorded by club admins or
              designated staff scorers.
            </li>
            <li>
              <strong>Payment references and recorded charges:</strong> Transaction amounts, payment
              method, and—when paying a club&apos;s GCash QR for a court booking—the 6-to-30-character
              GCash reference number you submit, submission time, and the club&apos;s confirmation or
              rejection reason, along with the recorded club charge and platform commission entry.
              Club membership requests are paid directly to the club (at the desk or via the club&apos;s
              own GCash) and recorded by staff upon approval; bRineLy does not connect to a live
              online payment processor.
            </li>
            <li>
              <strong>Coaching lesson requests and messages:</strong> Selected coach time slot,
              number of players, quoted lesson amount, request status, optional booking note, and
              private messages exchanged between the player and linked coach in that request
              thread.
            </li>
            <li>
              <strong>Court-owner call requests:</strong> Your name, club or venue name, city, court
              count, mobile number or email, preferred call date and time window, and any optional
              message submitted on the club-listing page.
            </li>
            <li>
              <strong>Club and coach listing details entered by club admins and coaches:</strong>{' '}
              Venue addresses, map pins, opening hours, court rates and photos, add-ons, business
              contact details, direct payment instructions (including an account name or number and
              QR images), and coach names, headlines, biographies, hourly and lesson rates, open
              lesson slots, booking policies, contact details, and uploaded photos. Some of this
              information may identify a person.
            </li>
          </ul>
          <p className="mt-2">
            You provide account, profile photo, membership request, booking, coaching request, and
            owner-request details directly. Club staff, designated scorers, coaches, and admins may
            enter member, walk-in, match, tournament, invitation, coach-slot, and business-listing
            details, and club admins choose which club details to publish publicly.
          </p>
          <p className="mt-2">
            Do not send sensitive personal information (such as government IDs or health records)
            unless it is specifically requested for a stated lawful purpose.
          </p>
        </>
      ),
    },
    {
      title: 'Why we use information and lawful bases',
      content: (
        <>
          <p>
            Under the Philippine Data Privacy Act of 2012 (RA 10173, Section 12), we process personal
            information only on a permitted legal basis:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Providing requested services (contract or pre-contractual steps):</strong>{' '}
              Creating and managing accounts, updating your profile and QR pass wallet, joining
              clubs, processing club membership requests, holding and booking courts, submitting
              payment references for club confirmation, managing open-play sign-ups and QR
              check-ins, recording club leaderboard and tournament matches, handling coaching lesson
              requests and messages, and answering support inquiries.
            </li>
            <li>
              <strong>Accounting, commissions, and legal compliance (contract and legal obligation):</strong>{' '}
              Recording confirmed club charges, tracking platform commissions on court bookings, and
              meeting applicable Philippine tax, accounting, or regulatory obligations.
            </li>
            <li>
              <strong>Court-owner onboarding (consent and pre-contractual request):</strong>{' '}
              Contacting court owners who opt in on the "List your club" form and managing club
              owner invitations.
            </li>
            <li>
              <strong>Security, abuse prevention, and support (legitimate interest):</strong>{' '}
              Enforcing hashed sign-in rate limits and form flood limits, preventing duplicate
              active payment references within a club, keeping platform audit logs, computing
              aggregate, non-identifying club and platform operational analytics, and providing
              time-limited, read-only club support views in ways that do not override your
              fundamental rights and freedoms.
            </li>
          </ul>
          <p className="mt-2">
            If sensitive personal information ever needs to be processed, an applicable legal basis
            under Section 13 of RA 10173 must be confirmed first.
          </p>
        </>
      ),
    },
    {
      title: 'Who can see information and service providers',
      content: (
        <>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Other players, public pages, and TV boards:</strong> Ordinary members in the
              same club cannot view each other&apos;s private court bookings, open-play sign-ups,
              check-ins, contact details, member codes, or charges, and court-booking TV schedule
              views display only court status labels (<code>In use</code>, <code>Reserved</code>,{' '}
              <code>Open play</code>) and open-play seat counts, never player names. However, when
              you participate in a recorded club match or tournament, public club leaderboards,
              tournament pages (including the cross-club tournaments directory), and leaderboard or
              tournament TV board views display your full name, nickname, profile photo, team
              pairing, scores, and win/loss standings—never your email, phone number, member code,
              or payment records. Anyone with the direct link to a profile photo in the public{' '}
              <code>member-photos</code> bucket can view that image.
            </li>
            <li>
              <strong>Club staff, scorers, and admins:</strong> Authorized staff (scoped to assigned
              venues) and club admins can access member, membership-request, booking,
              payment-reference, walk-in, check-in (including your nickname and profile photo when
              scanning your QR pass), and support records needed to run that club, and club admins
              view aggregate club analytics. Club admins and designated staff scorers record and
              void leaderboard and tournament match results.
            </li>
            <li>
              <strong>Linked club coaches:</strong> When you request a coaching lesson slot, the
              linked coach account receives your full name, email address, lesson request details,
              and messages in that request thread to coordinate your lesson.
            </li>
            <li>
              <strong>Platform superadmins:</strong> Authorized platform superadmins can view
              court-owner call requests, owner invitations, platform commission records, and
              aggregate cross-club analytics (counts and totals only, without member names or
              contact details). A superadmin may also open a reason-recorded, time-limited (5 to
              120 minutes), read-only support view of one club showing club settings, counts,
              venues, today&apos;s schedule, and open inquiry subjects and status—never member names,
              contact details, or individual payment records. Opening, reading, and closing that
              view are recorded in an audit log.
            </li>
            <li>
              <strong>Infrastructure, realtime, and email providers:</strong> We use{' '}
              <strong>Supabase</strong> for authentication, database, server-side functions,
              realtime refresh channels (carrying non-identifying update signals), and public photo
              storage (<code>court-photos</code> and <code>member-photos</code>), and{' '}
              <strong>Resend</strong> (when enabled in deployment configuration) for 6-digit sign-up
              verification codes and booking confirmation emails. When enabled, Resend receives the
              recipient&apos;s email address and booking details (such as club, location, court,
              schedule, amount, and payment reference) using a configured <code>@brinely.info</code>{' '}
              sender address such as <code>noreply@brinely.info</code> or{' '}
              <code>bookings@brinely.info</code>. If email sending is not configured, the app does
              not send external messages.
            </li>
            <li>
              <strong>Web hosting and maps:</strong> The app runs on static web and CDN hosting
              (including GitHub Pages for staging and configured <code>brinely.info</code> hosting).
              Where a club page has a map, it embeds <strong>OpenStreetMap</strong>, and choosing
              "Get directions" opens <strong>Google Maps</strong> with the public venue address or
              map pin. Those services receive standard browser and network request information when
              loaded or opened.
            </li>
          </ul>
          <p className="mt-2">
            Under Section 21(a) of RA 10173, cloud hosting and email providers may process or store
            data on servers outside the Philippines subject to security and contractual safeguards.
            Confirmed provider regions and the complete subprocessor list remain subject to final
            confirmation. We may also disclose information when required by law or valid legal
            order.
          </p>
        </>
      ),
    },
    {
      title: 'Club pages and public information',
      content: (
        <p>
          Club admins choose what to publish on public club pages and across bRineLy&apos;s public Find a
          court, Rent a coach, and Tournaments directories. This can include club contact details,
          venue locations, court rates, amenities, coaches&apos; names, headlines, biographies, hourly
          and lesson rates, open lesson times, booking policies, contact details and photos, club,
          venue, or court photos, and public club leaderboards and tournament brackets showing
          participating players&apos; names, nicknames, profile photos, and match results. A club may
          also publish payment instructions, including an account name or number and a QR image, so
          players can pay the club directly. These details and images may be visible to anyone on
          the internet. bRineLy does not take, hold, or verify direct-to-club payments. Clubs
          should publish only information and images they are authorized to share.
        </p>
      ),
    },
    {
      title: 'Browser storage and cookies',
      content: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Live mode:</strong> Uses essential browser storage (<code>localStorage</code>)
            to maintain your sign-in session, remember your last selected club, and cache your
            club QR check-in passes (<code>brinely.passes</code>) on your device so My QR opens
            with weak signal—cached passes are cleared automatically when you sign out. It also
            uses <code>sessionStorage</code> to hold a chosen court slot while you sign in or
            create an account, or a one-time confirmation message when a coaching request switches
            clubs.
          </li>
          <li>
            <strong>Demo mode:</strong> When database settings are absent, demo data is stored
            locally in your browser (<code>localStorage</code>), never stores passwords, and
            remains separate from live club servers.
          </li>
          <li>
            <strong>No ad tracking:</strong> bRineLy does not use advertising cookies, third-party
            analytics scripts, or cross-site behavioral trackers. Club and platform analytics
            screens use first-party aggregate operational totals only.
          </li>
        </ul>
      ),
    },
    {
      title: 'Minors and youth players',
      content: (
        <p>
          Portal accounts are intended for individuals aged 18 and older (the age of majority in
          the Philippines). Where a participating club allows junior or youth players under 18 in
          court bookings, open play, or coaching lessons, registration and bookings should be
          completed by or with the verifiable consent and supervision of a parent or legal
          guardian. Specific club age-verification and guardian rules remain subject to final
          confirmation with participating clubs.
        </p>
      ),
    },
    {
      title: 'Retention and security',
      content: (
        <>
          <p>We keep personal information only as long as needed for its stated purpose:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Hashed authentication rate-limit records automatically purge after 5 minutes, and
              replacing or removing your profile photo deletes previous files from your{' '}
              <code>member-photos</code> folder.
            </li>
            <li>
              Active account and club membership records are kept while your account or membership
              remains active, or as needed to manage your club relationship.
            </li>
            <li>
              Confirmed booking, membership-request, payment-reference, transaction, and platform
              commission records are retained for club accounting and Philippine tax recordkeeping.
            </li>
            <li>
              Leaderboard and tournament match histories, support inquiries, coaching threads,
              closed court-owner requests, platform audit logs, and backups are kept for operational
              accountability and disaster recovery. Specific numerical retention schedules and
              automated purge periods remain pending final confirmation.
            </li>
          </ul>
          <p className="mt-2">
            We apply organizational, physical, and technical safeguards including database row-level
            security, club and venue access boundaries, hashed authentication rate limits, HTTPS
            encryption in transit, and audited read-only support views. No method of storage or
            transmission can be guaranteed completely secure.
          </p>
        </>
      ),
    },
    {
      title: 'Your rights under RA 10173',
      content: (
        <>
          <p>Subject to legal conditions and exceptions, you have the right to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Be informed about how your personal information is processed and access it.</li>
            <li>Object to processing, or request correction, erasure, or blocking.</li>
            <li>Request data portability where applicable.</li>
            <li>
              Withdraw consent where processing is based on consent, without affecting prior lawful
              processing.
            </li>
            <li>
              File a complaint with the National Privacy Commission and seek indemnification or
              remedies provided by law.
            </li>
          </ul>
          <p className="mt-2">
            You can update your full name, nickname, and profile photo directly on your Account page
            in the app. Because self-service email changes and full account deletion are not yet
            built into the app, ask your club&apos;s staff or admin to update club-specific membership,
            walk-in, booking, or match records, or contact the platform privacy contact below for
            portal account access, email correction, or account deletion requests. We may verify
            your identity before acting on a request to protect your account.
          </p>
        </>
      ),
    },
    {
      title: 'Privacy contact and notice updates',
      content: (
        <>
          {club.isGensan ? (
            <p>
              For a privacy question or data rights request, email {portalContactLink}. This is a
              provisional contact pending confirmation of dedicated Data Protection Officer (DPO)
              or Compliance Officer for Privacy (COP) details, physical contact details, and
              confirmed response timelines.
            </p>
          ) : (
            <p>
              For questions or requests about club memberships, court bookings, coaching records, or
              direct payments, ask the staff at {clubLabel}. For bRineLy portal account privacy
              requests, email {portalContactLink}. A dedicated Data Protection Officer contact and
              confirmed response timelines have not been finalized yet.
            </p>
          )}
          <p className="mt-2">
            <strong>Changes to this notice:</strong> We may update this Privacy Notice when
            features, service providers, or legal requirements change, and will post updates here
            with a revised "Last updated" date. Final entity names, DPO details, and numerical
            retention schedules will be confirmed with a qualified Philippine privacy professional
            before official production sign-off.
          </p>
        </>
      ),
    },
  ]
}
