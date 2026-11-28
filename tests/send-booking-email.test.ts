import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildBookingEmail,
  DEFAULT_FROM_EMAIL,
  type BookingEmailPayload,
} from '../supabase/functions/send-booking-email/email.ts'

/*
 * The booking confirmation email keeps the quiet court look (solid navy header, hairlines,
 * sentence case) and escapes every value the client sends.
 */
const payload: BookingEmailPayload = {
  bookingId: 'b-1',
  clubName: 'Rally Point Gensan',
  venueName: 'Lagao courts',
  courtName: 'Court 2',
  startAt: '2026-11-24T10:00:00Z',
  endAt: '2026-11-24T12:00:00Z',
  hours: 2,
  amount: 900,
  paymentRef: '1234 567 890',
  recipientEmail: 'player@example.com',
}

describe('booking confirmation email', () => {
  it('uses the quiet court look', () => {
    const { html } = buildBookingEmail(payload)
    expect(html).not.toMatch(/linear-gradient/i)
    expect(html).not.toMatch(/text-transform\s*:\s*uppercase/i)
    expect(html).toContain('background:#0B2A5B')
    expect(html).toContain('IBM Plex Sans')
    expect(html).toContain('max-width:600px')
    expect(html).not.toMatch(/<img\b/i)
  })

  it('shows the booking in sentence-case rows', () => {
    const { html, subject } = buildBookingEmail(payload)
    expect(html).toContain('Total paid')
    expect(html).not.toContain('Total Paid')
    for (const label of ['Club', 'Court', 'Location', 'Date', 'Time', 'Payment reference']) {
      expect(html).toContain(`>${label}</td>`)
    }
    expect(html).toContain('Php 900.00')
    expect(html).toContain('Tue, Nov 24, 2026')
    expect(html).toContain('6:00 PM – 8:00 PM<br>')
    expect(html).toContain('2 hours, PH time')
    expect(html).toContain('You paid Rally Point Gensan directly. bRineLy does not receive or check this payment.')
    expect(subject).toBe('Booked: Court 2 (2 hours) · Rally Point Gensan')
  })

  it('escapes every value the client sends', () => {
    const { html } = buildBookingEmail({
      ...payload,
      clubName: '<b>Club</b> & "Co"',
      venueName: '<script>alert(1)</script>',
      courtName: "Court 'A'",
      paymentRef: '<img src=x>',
    })
    expect(html).not.toContain('<b>Club</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;b&gt;Club&lt;/b&gt; &amp; &quot;Co&quot;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Court &#39;A&#39;')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('includes a plain-text alternative', () => {
    const { text } = buildBookingEmail(payload)
    expect(text).toContain('Court: Court 2')
    expect(text).toContain('Total paid: Php 900.00')
    expect(text).not.toMatch(/<[a-z]/i)
  })

  it('leaves optional rows out when they are missing', () => {
    const { html, text } = buildBookingEmail({ ...payload, venueName: null, paymentRef: null, clubName: undefined })
    expect(html).not.toContain('>Location</td>')
    expect(html).not.toContain('>Payment reference</td>')
    expect(html).toContain('You paid the club directly.')
    expect(text).not.toContain('Location:')
    expect(text).not.toMatch(/\n\n\n/)
  })

  it('defaults to the bRineLy sender, still overridable by RESEND_FROM_EMAIL', () => {
    expect(DEFAULT_FROM_EMAIL).toBe('bRineLy <bookings@brinely.info>')
    const source = readFileSync('supabase/functions/send-booking-email/index.ts', 'utf8')
    expect(source).toContain("Deno.env.get('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM_EMAIL")
    expect(source).not.toContain('resend.dev')
  })
})
