# Rally Point Gensan

Mobile-first **court rental + membership** web app for pickleball (Figma UI/UX → production).

**Owner-confirmed staging:** https://zylush.github.io/rally-point-web/

## Stack
Vite · React · TypeScript · Tailwind v4 · HashRouter · Supabase (demo fallback)

## Features
| Area | What’s in |
|------|-----------|
| Auth | Login (member / staff / admin) |
| Member | Book court · Open play · QR pass · Pay · Messages · Profile |
| Staff | Check-in (QR) · Schedule board · Open play · Courts |
| Admin | Home KPIs · Floor ops · Board · Open play · Bookings · Members · Users |
| Public | TV board `/#/board/tv` |
| Brand | Exact Figma `rpg_logo` (RALLY POINT GENSAN) |

## Quick start (demo)
```bash
cd Rally-Point-web
npm install
npm run dev
```
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@rallypoint.local | admin123 |
| Staff | staff@rallypoint.local | staff123 |
| Member | member@rallypoint.local | member123 |

*(Demo only when `.env` has no Supabase keys.)*

## Supabase (live)
1. Replay SQL in order through all three tenant-ready phases, locally/staging first:
   - `supabase/migrations/001_rally_point.sql`
   - `supabase/migrations/002_bookings.sql`
   - `supabase/migrations/003_open_play_qr.sql`
   - `supabase/migrations/004_member_signup.sql`
   - `supabase/migrations/20260803125450_authorization_boundary.sql`
   - `supabase/migrations/20260805094557_auth_rate_limits.sql`
   - `supabase/migrations/20260921090000_tenant_ready.sql` (expand)
   - `supabase/migrations/20260921110828_tenant_backfill.sql`
   - `supabase/migrations/20260921111105_tenant_enforcement.sql`
   Read `docs/TENANT-READY-ROLLOUT.md` and verify the schema fingerprint before any hosted cutover. Enforcement is deferred until a separately approved write pause and old-client drain; do not apply every listed migration to staging as one batch.
   Staff/admin identities are provisioned by a trusted operator; assign `club_staff_roles` and `staff_venue_grants` after the account exists.
2. **Members** join themselves on the login page (“Join as member”).
3. **Staff / admin** — create manually in Supabase Auth, then:
   ```sql
   -- Do not set authorization through profiles.role from the client.
   -- Use trusted club_staff_roles and staff_venue_grants provisioning.
   ```
   Do **not** use the public join form for staff/admin.
4. Auth → optional: turn **off** “Confirm email” for instant join, or leave on and members confirm first.
5. `.env`:
```env
VITE_SUPABASE_URL=https://YOUR.supabase.co
VITE_SUPABASE_ANON_KEY=your_publishable_key
```
Never put `service_role` in the frontend.

Live members can view availability, but online court checkout and membership renewal remain unavailable until the payment phase. Staff reservations and desk charges are recorded as unpaid/unverified until collection is confirmed. Blank Supabase values use the browser-local demo, where checkout simulation is explicitly labeled.

## Who sees what
| Role | Access |
|------|--------|
| **Member** | Own home, venue availability, open play, QR pass, messages, profile. **No** desk ops, all-members list, revenue, user admin. |
| **Staff** | Check-in, schedule board, open-play manage, courts, bookings desk at assigned venues. |
| **Admin** | Everything staff has across the club + members CRUD, venue/access settings, floor ops, transactions, user list, KPIs. |


## Prepare the staging build (no deployment)

`.env.staging` fixes the target to Rally-Point-Database (`iclrvvsiwypxlwrwgqia`)
and the GitHub Pages base path. Supply that project's existing publishable key
as `VITE_SUPABASE_ANON_KEY` in the process environment or ignored
`.env.staging.local`. Never use a secret/service-role key. The current hosted
bundle points at the intended project, but that observation can change; verify
the publishable key's project association with a read-only request before
approving a new artifact.

```bash
npm run build:staging
npm run preview:staging
```

This builds into ignored `staging-artifact.local/`, separate from ordinary
`dist/`. Staging builds reject a wrong URL, missing/unsafe key, or wrong base.
Key-format validation is not proof that a publishable key belongs to the project;
verify its origin and a read-only request before approving an artifact.
Normal `npm run build` with blank Supabase values still builds the demo.

Publishing requires separate approval. **Do not use `npm run deploy` for this
staging artifact:** that legacy command rebuilds ordinary `dist` and publishes it.
Only publish the exact reviewed staging artifact after the release gates permit
it. Building locally does not change GitHub Pages or any database. Database
enforcement remains separately gated.

## UX rules
- Plain English, large type, ≥52px taps (mixed-age players)
- Phone + desktop layouts
- Exact Figma logo assets in `public/logo.png` + `logo-mark.png`

## Scripts
- `npm run dev` — local
- `npm run build` — production
- `npm run deploy` — build + gh-pages
- `npm run preview` — preview dist
