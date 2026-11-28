import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Provisional contact pending confirmation of its role by the bRineLy team.
const brinelyContactEmail = 'admin@brinely.info'

export const TERMS_UPDATED = 'November 28, 2026'

export type TermsSection = { title: string; content: ReactNode }

/** The sections of the Terms of use shown on `/terms`, in reading order. */
export function termsSections(): TermsSection[] {
  const contactLink = (
    <a
      className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline"
      href={`mailto:${brinelyContactEmail}`}
    >
      {brinelyContactEmail}
    </a>
  )

  const privacyLink = (
    <Link className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline" to="/privacy">
      Privacy Notice
    </Link>
  )

  return [
    {
      title: 'About these terms',
      content: (
        <p>
          These terms explain how the bRineLy booking portal works, in plain language. Please read
          them before you book a court or pay a club.
        </p>
      ),
    },
    {
      title: 'Who does what',
      content: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>bRineLy</strong> runs the booking portal software.
          </li>
          <li>
            <strong>Each club</strong> is the court owner. It runs its own courts and sets its own
            prices, opening hours, house rules and cancellation policy. You can find these on the
            club&apos;s page.
          </li>
        </ul>
      ),
    },
    {
      title: 'Paying for a booking',
      content: (
        <>
          <p>
            You pay the club directly, using the club&apos;s own GCash QR code or GCash number shown
            at checkout.
          </p>
          <p className="mt-2">
            bRineLy never receives, holds or forwards your money, and bRineLy is not a payment
            provider.
          </p>
          <p className="mt-2">
            <strong>Before you send money,</strong> check that the account name in GCash matches the
            club you are booking with.
          </p>
        </>
      ),
    },
    {
      title: 'How a booking works',
      content: (
        <ol className="list-decimal space-y-1 pl-5">
          <li>When you pick your hours, they are held for you for 15 minutes while you pay.</li>
          <li>After you pay, type in your GCash reference number.</li>
          <li>The club&apos;s staff check your payment. Your hours are booked only after they confirm it.</li>
          <li>Staff can reject a payment, and if they do they must give a reason.</li>
          <li>
            If you do not send your payment reference within 15 minutes, the hold lapses and the hours
            are free again. Once you have sent it, your hours stay held until the club decides.
          </li>
        </ol>
      ),
    },
    {
      title: 'Cancellations and refunds',
      content: (
        <>
          <p>
            The app cannot cancel or refund a confirmed booking. Each club sets its own cancellation
            policy, shown on its club page.
          </p>
          <p className="mt-2">
            Any refund, or any disagreement about a payment, is between you and the club. Please
            contact the club directly. If the club has listed a phone number, you will find it on its
            club page.
          </p>
          <p className="mt-2">bRineLy cannot reverse a GCash payment.</p>
        </>
      ),
    },
    {
      title: 'Your account',
      content: (
        <>
          <ul className="list-disc space-y-1 pl-5">
            <li>One person per account.</li>
            <li>Use your real name.</li>
            <li>Keep your password private.</li>
            <li>Do not send fake payment reference numbers or misuse the site in any other way.</li>
          </ul>
          <p className="mt-2">
            A club can suspend members of that club. bRineLy can close accounts that misuse the
            site.
          </p>
        </>
      ),
    },
    {
      title: 'Public information',
      content: (
        <>
          <p>
            Club pages, the TV schedule board, leaderboards and tournament brackets are public:
            anyone can see them.
          </p>
          <p className="mt-2">
            Leaderboards and tournament brackets show players&apos; names, nicknames and photos. They
            never show contact details.
          </p>
          <p className="mt-2">To learn how personal information is handled, read the {privacyLink}.</p>
        </>
      ),
    },
    {
      title: 'Clubs listed on bRineLy',
      content: (
        <>
          <p>
            bRineLy lists only clubs that have signed up. A listing is not an endorsement, and it is
            not a guarantee of court quality.
          </p>
          <p className="mt-2">
            Club and court photos are supplied by the clubs. Where a club has not added one, the site
            shows a stock photo labelled &quot;Sample photo&quot;, which is not a picture of that club.
          </p>
        </>
      ),
    },
    {
      title: 'Changes to these terms',
      content: (
        <p>
          These terms may change. The &quot;Last updated&quot; date at the top of this page shows the
          latest version.
        </p>
      ),
    },
    {
      title: 'Contact',
      content: <p>For a question about these terms, email {contactLink}.</p>,
    },
  ]
}
