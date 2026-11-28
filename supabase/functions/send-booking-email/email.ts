// Pure builders for bRineLy email cards (sign-up auth, booking email, booking confirmation,
// and password reset). No Deno or network calls here, so every card can be tested from vitest
// (tests/send-booking-email.test.ts).

/**
 * Default sender when RESEND_FROM_EMAIL is not set.
 * Emails come from no-reply@brinely.info once brinely.info is verified in Resend.
 */
export const DEFAULT_FROM_EMAIL = 'bRineLy <no-reply@brinely.info>'

export type BookingEmailKind = 'booking_submitted' | 'booking_confirmed'

export interface BookingEmailPayload {
  bookingId: string
  clubName: string
  venueName?: string | null
  courtName: string
  startAt: string
  endAt: string
  hours: number
  amount: number
  paymentRef?: string | null
  recipientEmail: string
  kind?: BookingEmailKind
}

export interface BookingEmail {
  subject: string
  html: string
  text: string
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatManilaDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
}

function formatManilaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  })
}

// Quiet court palette, written out because email clients ignore stylesheets.
const canvas = '#FAFAF7'
const navy = '#0B2A5B'
const accent = '#0369A1'
const hairline = '#E7E5E0'
const muted = '#475467'
const sky = '#38BDF8'
const font = "'IBM Plex Sans',Arial,Helvetica,sans-serif"
const mono = "'IBM Plex Mono',Consolas,Menlo,monospace"

function row(label: string, valueHtml: string, valueStyle = ''): string {
  return `<tr>
                  <td style="padding:12px 0;border-top:1px solid ${hairline};color:${muted};font-size:14px;line-height:20px;vertical-align:top;width:38%;">${label}</td>
                  <td style="padding:12px 0;border-top:1px solid ${hairline};color:${navy};font-size:15px;line-height:21px;font-weight:600;text-align:right;vertical-align:top;${valueStyle}">${valueHtml}</td>
                </tr>`
}

/**
 * Sign-up authentication email card (6-digit verification code from no-reply@brinely.info).
 * Matches supabase/templates/confirm_signup.html.
 */
export function buildSignupAuthEmail(opts: { token?: string; recipientEmail?: string } = {}): BookingEmail {
  const rawToken = opts.token ?? '{{ .Token }}'
  const safeToken = rawToken === '{{ .Token }}' ? rawToken : escapeHtml(rawToken)
  const subject = 'Confirm your bRineLy email'
  const preheader = 'Your 6-digit bRineLy verification code.'

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${canvas};font-family:${font};color:${navy};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${canvas};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${hairline};border-radius:12px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px 22px;background:${navy};color:#FFFFFF;border-radius:11px 11px 0 0;">
                <p style="margin:0 0 14px;font-size:15px;line-height:20px;font-weight:700;letter-spacing:0.01em;color:#FFFFFF;">bRineLy<span style="color:${sky};">.</span></p>
                <p style="margin:0;font-size:14px;line-height:20px;color:#C9D4E5;">Account verification</p>
                <h1 style="margin:4px 0 0;font-size:24px;line-height:30px;font-weight:600;color:#FFFFFF;">Confirm your email</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 8px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${navy};">
                  Enter this 6-digit verification code in bRineLy to finish setting up your player account:
                </p>
                <div style="margin:0 0 16px;padding:18px 16px;border:1px solid ${hairline};border-radius:10px;background:${canvas};text-align:center;">
                  <span style="font-family:${mono};font-size:32px;line-height:38px;font-weight:700;letter-spacing:0.25em;color:${navy};">${safeToken}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 24px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:${muted};">
                  This code expires in 60 minutes. If you did not try to create a bRineLy account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:${muted};">Sent by <span style="color:${accent};font-weight:600;">bRineLy</span> · no-reply@brinely.info</p>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim()

  const text = [
    'Confirm your email · bRineLy',
    '',
    'Enter this 6-digit verification code in bRineLy to finish setting up your player account:',
    '',
    rawToken,
    '',
    'This code expires in 60 minutes. If you did not try to create a bRineLy account, you can safely ignore this email.',
    '',
    'Sent by bRineLy · no-reply@brinely.info',
  ].join('\n')

  return { subject, html, text }
}

/**
 * Booking email card sent when a booking request / GCash reference is submitted and waiting
 * for the club to confirm, or booking confirmation card once confirmed.
 */
export function buildBookingSubmittedEmail(body: Partial<BookingEmailPayload>): BookingEmail {
  return buildBookingEmail({ ...body, kind: 'booking_submitted' })
}

/** Builds the subject, HTML and plain-text bodies for booking email & booking confirmation cards. */
export function buildBookingEmail(body: Partial<BookingEmailPayload>): BookingEmail {
  const kind: BookingEmailKind = body.kind === 'booking_submitted' ? 'booking_submitted' : 'booking_confirmed'
  const isSubmitted = kind === 'booking_submitted'
  const clubName = body.clubName ?? 'bRineLy'
  const courtName = body.courtName ?? ''
  const hoursLabel = `${body.hours} ${body.hours === 1 ? 'hour' : 'hours'}`
  const formattedAmount = `Php ${Number(body.amount ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  const dateLabel = formatManilaDate(body.startAt ?? '')
  const timeRange = `${formatManilaTime(body.startAt ?? '')} – ${formatManilaTime(body.endAt ?? '')}`
  const timeLabel = `${timeRange} (PH time)`
  const payee = body.clubName ? clubName : 'the club'

  const subject = isSubmitted
    ? `Booking request: ${courtName} (${hoursLabel}) · ${clubName}`
    : `Booked: ${courtName} (${hoursLabel}) · ${clubName}`
  const heading = isSubmitted ? 'Booking request received' : 'Booking confirmed'
  const lead = isSubmitted
    ? 'We received your booking and payment reference. Your hours stay held while the club checks your payment.'
    : 'Your court is booked. Here are the details.'
  const amountLabel = isSubmitted ? 'Amount sent' : 'Total paid'
  const callout = isSubmitted
    ? 'Your hours are held while staff check the club’s GCash. You will receive your booking confirmation as soon as the club confirms.'
    : 'Confirmed bookings are final (no refund). Present your booking confirmation or member QR code at the desk when you arrive.'

  const rows = [
    row('Club', escapeHtml(clubName)),
    row('Court', escapeHtml(courtName)),
    body.venueName ? row('Location', escapeHtml(body.venueName)) : '',
    row('Date', escapeHtml(dateLabel)),
    row('Time', `${escapeHtml(timeRange)}<br><span style="font-weight:400;color:${muted};font-size:14px;">${escapeHtml(hoursLabel)}, PH time</span>`),
    isSubmitted ? row('Status', 'Waiting for the club to confirm') : '',
    body.paymentRef
      ? row('Payment reference', escapeHtml(body.paymentRef), `font-family:${mono};font-weight:500;`)
      : '',
    row(amountLabel, escapeHtml(formattedAmount), `font-size:18px;line-height:24px;font-weight:700;color:${navy};`),
  ]
    .filter(Boolean)
    .join('\n                ')

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${canvas};font-family:${font};color:${navy};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(`${courtName}, ${dateLabel}, ${timeLabel}`)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${canvas};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${hairline};border-radius:12px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px 22px;background:${navy};color:#FFFFFF;border-radius:11px 11px 0 0;">
                <p style="margin:0 0 14px;font-size:15px;line-height:20px;font-weight:700;letter-spacing:0.01em;color:#FFFFFF;">bRineLy<span style="color:${sky};">.</span></p>
                <p style="margin:0;font-size:14px;line-height:20px;color:#C9D4E5;">${escapeHtml(clubName)}</p>
                <h1 style="margin:4px 0 0;font-size:24px;line-height:30px;font-weight:600;color:#FFFFFF;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 8px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${navy};">${lead}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${rows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 24px;">
                <p style="margin:0 0 12px;padding:12px 14px;border:1px solid ${hairline};border-radius:8px;background:${canvas};font-size:14px;line-height:21px;color:${navy};">
                  ${callout}
                </p>
                <p style="margin:0;font-size:13px;line-height:20px;color:${muted};">
                  You paid ${escapeHtml(payee)} directly. bRineLy does not receive or check this payment.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:${muted};">Sent by <span style="color:${accent};font-weight:600;">bRineLy</span> for ${escapeHtml(clubName)} · no-reply@brinely.info</p>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim()

  const text = [
    `${heading} · ${clubName}`,
    '',
    `Club: ${clubName}`,
    `Court: ${courtName}`,
    body.venueName ? `Location: ${body.venueName}` : null,
    `Date: ${dateLabel}`,
    `Time: ${timeLabel} · ${hoursLabel}`,
    isSubmitted ? 'Status: Waiting for the club to confirm' : null,
    body.paymentRef ? `Payment reference: ${body.paymentRef}` : null,
    `${amountLabel}: ${formattedAmount}`,
    '',
    callout,
    '',
    `You paid ${payee} directly. bRineLy does not receive or check this payment.`,
  ]
    .filter((line) => line !== null)
    .join('\n')

  return { subject, html, text }
}
