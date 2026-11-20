# bRineLy — Resend Email Verification & Booking Receipt Setup

bRineLy (`brinely.info`) uses **Resend** for:
1. **Sign-up 6-digit email verification codes (OTP)** via Supabase Auth Custom SMTP.
2. **Booking confirmation receipts** (`Booked · n hours · No refund`) via the `send-booking-email` Supabase Edge Function.

> **Security note:** Never place `RESEND_API_KEY` in any frontend `.env` or `VITE_*` variable. Keep API keys solely in Supabase Dashboard Auth SMTP settings and Supabase Edge Function secrets.

---

## 1. Enable Resend SMTP for Auth Verification Codes
In the **Supabase Dashboard** → **Project Settings** → **Authentication** → **SMTP Settings**:
- **Enable Custom SMTP:** ON
- **Host:** `smtp.resend.com`
- **Port:** `465` (or `587`)
- **Username:** `resend`
- **Password:** `<your RESEND_API_KEY>`
- **Sender email:** Your verified Resend domain address (e.g., `noreply@brinely.info`)
- **Sender name:** `bRineLy`

Then in **Authentication** → **Email Templates** → **Confirm signup**, paste the HTML from [`supabase/templates/confirm_signup.html`](../supabase/templates/confirm_signup.html) so users receive a branded 6-digit verification code (`{{ .Token }}`). Make sure **Confirm email** is enabled under **Authentication** → **Providers** → **Email**.

---

## 2. Deploy the `send-booking-email` Edge Function
```bash
supabase secrets set RESEND_API_KEY=re_your_api_key
supabase secrets set RESEND_FROM_EMAIL="bRineLy <bookings@brinely.info>"
supabase functions deploy send-booking-email
```

When a booking is confirmed in live mode, the client calls `supabase.functions.invoke('send-booking-email', ...)` with the caller's verified JWT token. In local demo mode (`npm run dev`), confirmation emails are simulated cleanly in-app without requiring network credentials.
