# Rally Point Club — tenant-ready architecture

Status: proposed target design, not deployed. The six editable frames are on the **Architecture - Tenant-Ready** page of the existing [Figma UI/UX file](https://www.figma.com/design/ZjkjLoqiy7UyV6u3ph5mBt/UI-UX?node-id=640-852&p=f). `index.html` is a local review sheet. Run `node architecture/tenant-ready/generate.mjs` to regenerate it and the six SVG panels.

## Decision and phase boundary

Rally Point Club remains a **single-tenant web application** in the first release: one active club, one club experience, and no club switcher or self-service tenant onboarding. Its **multi-tenant data model** is tenant-ready. Add a `clubs` record for Rally Point and carry `club_id` on every club-owned row. A club may operate several venues. Membership belongs to the club and applies at all its venues. Club admins can work across its venues; staff are limited to assigned venues.

The database must enforce club and venue ownership even with one active club. A build-time or browser-selected club ID only guides the UI; it never grants access. Future deployment topology remains open. The current repository has single-club `members`, `courts`, and roles and does not yet enforce this proposed model. See `docs/ARCHITECTURE.md` and `docs/PRD.md` for current behavior.

| Phase | Application and control plane |
| --- | --- |
| Tenant-ready release | Rally Point Club is the only active tenant. App routes and navigation stay focused on this club. Club-scoped keys, foreign keys, RLS, grants, and tests are in place. |
| Later platform phase | Activate additional clubs, dynamic club context, a separate superadmin portal, club CRM, tenant provisioning, and scoped support sessions. A player may then use one identity across clubs, while each membership stays club-owned. |

## Proposed records and keys

| Phase and scope | Record | Essential keys and constraints |
| --- | --- | --- |
| Now: identity | `auth.users`, `profiles` | Existing Rally Point sign-in. Player contact data remains self-owned. |
| Now: club | `clubs`, `club_memberships` | One active Rally Point club row. Current membership is unique on `(club_id, user_id)`; renewals and payments retain history. |
| Now: club staff | `club_staff_roles` | Trusted `(user_id, club_id, role)` assignment. Public signup remains player-only. |
| Now: venue | `venues`, `staff_venue_grants`, `resources` | Venue belongs to a club. Resource and staff grant must refer to a venue in that club. |
| Now: operations | bookings, open play, check-ins, transactions, notifications | Tenant-owned rows carry `club_id`; venue activity also carries `venue_id`. Composite foreign keys prevent mismatched club and venue references. |
| Payment target | `club_payment_accounts`, intents, events, ledger entries | Rally Point merchant account first. Account and financial rows carry `club_id`; webhook event IDs are unique. Per-club accounts are enabled before adding clubs. |
| Later: platform | `platform_roles`, club CRM/account records, `support_sessions`, support audit | Superadmin is separate from club admin. CRM tracks clubs as business customers. Support sessions name one club, reason, expiry, and read scope. |

Use immutable IDs in relationships. Every access path derives authority from trusted membership, role, and venue-grant records. Do not expose a service-role key in the browser. A synthetic second club in local/staging tests must be denied by the same policies that protect Rally Point in production.

## Access rules

| Actor | Allowed scope |
| --- | --- |
| Player | Own profile, Rally Point membership, bookings, and participation. |
| Venue staff | Operational records at assigned Rally Point venues. |
| Club admin | All Rally Point venues and club-owned settings and records. |
| Public TV | Deliberately published minimal schedule projection; no direct tenant-table read. |
| Superadmin (later) | Platform CRM, club provisioning, reports, and audited tenant support reads. No routine write path to club bookings or memberships. |

In the later platform phase, support access requires one club, a reason, and an expiring read-only session. Log entry and tenant reads. It does not require per-session club approval. The superadmin role must never receive a blanket browser policy for all club data.

## Commands and payments

Keep the React/HashRouter shell and `src/lib/api.ts` as the screen-facing boundary. The first release uses a fixed Rally Point club context and a selected venue only where needed. Trusted commands (for example scoped database RPCs or Supabase Edge Functions) validate ownership and perform booking, membership, and payment operations. The demo adapter remains browser-local.

Reservation creation must validate membership and rules and allocate a court interval atomically. A pending payment gets an expiring hold. Database constraints or transactional locking prevent overlapping active bookings when clients race. Failed payment or timeout releases the hold. Rally Point's own merchant account receives payment. A verified, idempotent webhook confirms the booking and writes club ledger entries. Provider choice, pricing, cancellations, and refunds still need product decisions. The current payment UI is simulated and must not be treated as collected money.

## Migration and activation gates

1. Reconcile the actual target database with ordered migrations and current data. The repository does not prove hosted schema state.
2. Create Rally Point's club and venues, then backfill existing records with verified `club_id`/`venue_id` ownership without changing their identities.
3. Add matching foreign keys, indexes, RLS, and grants. Test allowed Rally Point operations and denied access to a synthetic second club in local/staging.
4. Move reservation, checkout, and public TV paths to trusted operations. Verify booking races, webhook retries, and payment reconciliation in a sandbox.
5. Keep production at one club for the tenant-ready release. Activate the superadmin/CRM control plane and additional clubs only after two-club isolation, support audit, and per-club payment checks pass in staging.

Do not apply the dated authorization migration to live data as part of this design. Its header requires local/staging verification first. The Figma panels and SVGs are architecture artifacts, not evidence that controls are deployed.
