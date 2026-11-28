# bRineLy (`brinely.info`) — Domain, Resend & Email Card Setup

bRineLy (`brinely.info`) sends all transactional emails through **Resend** from `no-reply@brinely.info`:
1. **Sign-up auth confirmation card (6-digit OTP)** — [`supabase/templates/confirm_signup.html`](../supabase/templates/confirm_signup.html)
2. **Password reset card** — [`supabase/templates/reset_password.html`](../supabase/templates/reset_password.html)
3. **Booking email card (payment reference submitted / waiting for club check)** — [`supabase/functions/send-booking-email/email.ts`](../supabase/functions/send-booking-email/email.ts) (`kind: 'booking_submitted'`)
4. **Booking confirmation card (court booked & confirmed)** — [`supabase/functions/send-booking-email/email.ts`](../supabase/functions/send-booking-email/email.ts) (`kind: 'booking_confirmed'`)

> **Security note:** Never place `RESEND_API_KEY` in any frontend `.env` or `VITE_*` variable. Keep API keys solely in Supabase Dashboard Auth SMTP settings and Supabase Edge Function secrets.

---

## 1. Squarespace Domain Manager Setup (`brinely.info`)

To connect `brinely.info` for the bRineLy website and Resend email authentication (SPF, DKIM, and DMARC) without sharing billing credentials:

1. Go to `https://account.squarespace.com/domains` and log in.
2. Click **`brinely.info`**.
3. Click **`Permissions`**.
4. Click **`Invite domain manager`**.
5. Send domain manager invites to:
   - **Ezzy** — `ezzyflecil@gmail.com`
   - **Paolo** — `paoloinigo30@gmail.com`
   - **Brendon** — `bedwuzhir@gmail.com`
   - **Dayle** — `daylepena@gmail.com`
6. Click **`Send invite`**.

### What this preserves for the domain owner
- **Full ownership stays with the owner:** Domain managers cannot view billing/payment details, cancel renewal, delete the domain, or transfer ownership, and can be removed at any time from the same **Permissions** page.
- **Existing Gmail at `admin@brinely.info` is unchanged:** Resend uses subdomain/TXT verification records (`send.brinely.info` and `resend._domainkey.brinely.info`), leaving existing Google Workspace MX records and `admin@brinely.info` mail delivery completely untouched.
- **Optional Resend dashboard access:** An optional Resend viewer invite can be sent to `admin@brinely.info` to inspect sent emails.

---

## 2. Verify `brinely.info` in Resend (`no-reply@brinely.info`)

1. In **Resend** → **Domains** → **Add Domain**, add `brinely.info`.
2. In Squarespace (`brinely.info` → **DNS** → **DNS Settings**), add the Resend DNS records:
   - **DKIM (`TXT`):** `resend._domainkey` → `<Resend DKIM value>`
   - **SPF (`MX` and `TXT` on `send`):** `send` → `feedback-smtp...amazonses.com` (priority `10`) and `v=spf1 include:amazonses.com ~all`
   - **DMARC (`TXT`):** `_dmarc` → `v=DMARC1; p=none;`
3. Click **Verify DNS Records** in Resend. Once verified, bRineLy sends all emails from:
   - **Sender name:** `bRineLy`
   - **Sender email:** `no-reply@brinely.info`

---

## 3. Enable Resend SMTP & Email Card Templates in Supabase Auth

In the **Supabase Dashboard** → **Project Settings** → **Authentication** → **SMTP Settings**:
- **Enable Custom SMTP:** ON
- **Host:** `smtp.resend.com`
- **Port:** `465` (or `587`)
- **Username:** `resend`
- **Password:** `<your RESEND_API_KEY>`
- **Sender email:** `no-reply@brinely.info`
- **Sender name:** `bRineLy`

Then in **Authentication** → **Email Templates**:
- **Confirm signup:** Paste [`supabase/templates/confirm_signup.html`](../supabase/templates/confirm_signup.html) (`{{ .Token }}` 6-digit OTP card).
- **Reset password:** Paste [`supabase/templates/reset_password.html`](../supabase/templates/reset_password.html) (`{{ .ConfirmationURL }}` card).
- Ensure **Confirm email** is enabled under **Authentication** → **Providers** → **Email**.

---

## 4. Deploy the `send-booking-email` Edge Function

```bash
supabase secrets set RESEND_API_KEY=re_your_api_key
supabase secrets set RESEND_FROM_EMAIL="bRineLy <no-reply@brinely.info>"
supabase functions deploy send-booking-email
```

When a booking is confirmed in live mode, the client calls `supabase.functions.invoke('send-booking-email', ...)` with the caller's verified JWT token. In local demo mode (`npm run dev`), confirmation emails are simulated cleanly in-app without requiring network credentials.
