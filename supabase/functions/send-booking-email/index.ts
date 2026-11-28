import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildBookingEmail, DEFAULT_FROM_EMAIL, type BookingEmailPayload } from './email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-club-id',
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
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM_EMAIL
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

  const { subject, html, text } = buildBookingEmail(body)

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [targetEmail],
      subject,
      html,
      text,
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
