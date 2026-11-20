import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-club-id',
}

interface BookingEmailPayload {
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
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatManilaRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const datePart = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
  const startPart = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  })
  const endPart = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  })
  return `${datePart} · ${startPart} – ${endPart} (PH time)`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authHeader = req.headers.get('Authorization')
  if (!supabaseUrl || !supabaseAnonKey || !authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userResult, error: userError } = await authClient.auth.getUser()
  if (userError || !userResult?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'bRineLy <onboarding@resend.dev>'
  if (!resendApiKey) {
    return new Response(JSON.stringify({ sent: false, reason: 'RESEND_API_KEY not configured' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = (await req.json()) as Partial<BookingEmailPayload>
  const targetEmail = (userResult.user.email || body.recipientEmail || '').trim()
  if (!targetEmail || !body.courtName || !body.startAt || !body.endAt || !body.hours) {
    return new Response(JSON.stringify({ error: 'Missing required booking fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const hoursLabel = `${body.hours} ${body.hours === 1 ? 'hour' : 'hours'}`
  const formattedAmount = `Php ${Number(body.amount ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  const timeWindow = formatManilaRange(body.startAt, body.endAt)

  const html = `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:24px;background:linear-gradient(135deg,#0f766e,#115e59);color:#ffffff;">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">${escapeHtml(body.clubName ?? 'bRineLy')}</p>
          <h1 style="margin:6px 0 0;font-size:22px;">Booking confirmed</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 16px;">
            <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:700;">Booked · ${escapeHtml(hoursLabel)}</span>
            <span style="display:inline-block;margin-left:6px;padding:4px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;">No refund</span>
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:12px 0;font-size:14px;">
            <tr><td style="padding:4px 0;color:#64748b;">Court</td><td style="padding:4px 0;text-align:right;font-weight:700;">${escapeHtml(body.courtName)}</td></tr>
            ${body.venueName ? `<tr><td style="padding:4px 0;color:#64748b;">Venue</td><td style="padding:4px 0;text-align:right;font-weight:600;">${escapeHtml(body.venueName)}</td></tr>` : ''}
            <tr><td style="padding:4px 0;color:#64748b;">Schedule</td><td style="padding:4px 0;text-align:right;font-weight:600;">${escapeHtml(timeWindow)}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b;">Total Paid</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#115e59;">${escapeHtml(formattedAmount)}</td></tr>
            ${body.paymentRef ? `<tr><td style="padding:4px 0;color:#64748b;">Reference</td><td style="padding:4px 0;text-align:right;font-family:monospace;">${escapeHtml(body.paymentRef)}</td></tr>` : ''}
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#475569;">
            Confirmed bookings are final (no refund). Present your booking confirmation or member QR code at the desk when you arrive.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim()

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [targetEmail],
      subject: `Booked: ${body.courtName} (${hoursLabel}) · ${body.clubName ?? 'bRineLy'}`,
      html,
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    return new Response(JSON.stringify({ sent: false, error: errText }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const data = await resendRes.json()
  return new Response(JSON.stringify({ sent: true, id: data?.id ?? null }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
