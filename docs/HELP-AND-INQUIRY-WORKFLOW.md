# Help and Inquiry Workflow

Developer handoff for the public login FAQ preview and the role-aware Help section.

## User-facing behavior

| Role | Help access |
| --- | --- |
| Member | View the full FAQ and Contact Us details for staff. Members do not submit inquiries through the form. |
| Staff | View the FAQ and admin contact details; submit categorized inquiries; view their own inquiry history, status, and the Admin response. Staff can see inquiry update notifications and mark them read in Help. |
| Admin | View the FAQ and superadmin contact details; submit inquiries; view the inquiry inbox; change inquiry status; send one response per inquiry. |

All three roles have a Help destination in the role-specific navigation. The full Help pages are `/member/help`, `/staff/help`, and `/admin/help`. FAQ wording is shared from `src/lib/helpContent.ts`.

The public login screen shows three expandable FAQ entries from the same shared content. It also shows Facebook and Instagram visual placeholders, but these are not links: official social URLs have not been supplied.

## Inquiry workflow

Staff and Admin submissions require a category, subject (up to 120 characters), and message (up to 2,000 characters). A submission starts with status `open`.

Admins can set an inquiry to `open`, `in_progress`, or `resolved`. An Admin may save one response of up to 2,000 characters per inquiry. After responding, the response is shown on both Admin and submitting Staff views. Admins may still change the status later.

When an Admin changes a status or sends a response, the submitting Staff account receives an in-app `Inquiry update` notification. Notifications are visible in the Staff Help page and can be marked read. Staff can use **Refresh** in Help to fetch current inquiry and notification data. This is not email, push, or realtime delivery; no external message is sent.

There is no five-item cap or automatic expiry. Inquiries persist until removed by database/demo reset or other explicit data deletion.

## Storage modes

### Demo mode

When Supabase configuration is blank or missing, `src/lib/supabase.ts` selects demo mode. Inquiries and notifications are stored in the browser-local demo database through `src/lib/demoStore.ts` and `src/lib/demo/inquiries.ts`. Each browser has its own demo data; demo records are not shared across browsers or users and are not live club records.

Use the seeded demo accounts from the README to inspect the workflow. Suggested walkthrough:

1. Sign in as Staff, submit two different inquiries from Help.
2. Sign out and sign in as Admin, open Help, and change one status or send one response.
3. Sign out and return as Staff. Open Help or choose Refresh to view the notification and inquiry update.

### Live Supabase mode

The API boundary in `src/lib/api.ts` writes to `public.support_inquiries`, reads inquiry lists, updates status/reply through a database RPC, and reads/updates `public.notifications`. The UI does not authorize database access; database RLS and grants are the security boundary.

Apply the existing migrations to a **verified local or staging target** in migration order. The Help inquiry workflow depends on:

1. The baseline schema migrations `001_rally_point.sql` through `004_member_signup.sql`.
2. The authorization and tenant migrations through `20260921111105_tenant_enforcement.sql`, including `private.current_club_id()` and `private.current_club_role(uuid)`.
3. Any intervening timestamped migrations in chronological order, including the tenant grant repair and later booking migrations.
4. `20260927105500_support_inquiries.sql`, which creates the inquiry table and read/insert RLS policies.
5. `20260928170000_support_inquiry_replies.sql`, which adds reply metadata and the Admin status/reply operation.

Do not run only the inquiry migrations against an incomplete or legacy schema. Confirm migration history and target before applying migrations; these files have **not** been applied to a live database as part of this work.

### Live authorization details

- A Staff user can insert an inquiry only for their own authenticated user ID and read only their own inquiries.
- Admins can read all inquiries for the current club. Inquiries have a required `club_id`; they are club-wide rather than venue-specific.
- Direct `UPDATE` permission on inquiries is revoked. Admin status/reply changes must use `public.admin_update_support_inquiry(...)`.
- The RPC checks the caller’s active club Admin role, locks only an inquiry in that club, validates the status/reply, enforces the one-response rule, updates the inquiry, and inserts a notification with the same club ID in the same database transaction.
- Notification reads and mark-read updates remain scoped to the authenticated user by the existing notifications policies.

These controls require the authorization and inquiry migrations to be installed. Client-side role checks are not a substitute for RLS or the RPC role check.

## Implementation map

| Concern | Location |
| --- | --- |
| Role-gated routes | `src/App.tsx` |
| Role navigation and mobile layout | `src/components/Shell.tsx` |
| Shared FAQ content | `src/lib/helpContent.ts` |
| Role-aware Help, contact, inquiry form, inbox/history | `src/pages/HelpPage.tsx` |
| Public FAQ/social preview | `src/pages/LoginPage.tsx` |
| Domain types | `src/types.ts` |
| Demo/live data boundary | `src/lib/api.ts`, `src/lib/demoStore.ts`, `src/lib/demo/inquiries.ts` |
| Inquiry table and RLS | `supabase/migrations/20260927105500_support_inquiries.sql` |
| Reply RPC and notification transaction | `supabase/migrations/20260928170000_support_inquiry_replies.sql` |
| UI and demo workflow tests | `src/pages/HelpPage.test.tsx`, `src/lib/demoStore.inquiries.test.ts` |
| Database policy test | `supabase/tests/database/support_inquiries.test.sql` |

## Verification and known gaps

Run the application checks:

```bash
npm test
npm run lint
npm run build
```

The database policy test is pgTAP SQL and must be run against a prepared local/test Supabase database after the prerequisite migrations. In the implementation environment, the Supabase CLI and `psql` were unavailable, so the SQL test was added but not executed. Do not infer live database readiness from a successful frontend build.

Remaining product/setup items:

- Confirm and replace the placeholder Contact Us emails and phone numbers in `src/pages/HelpPage.tsx`.
- Supply official social URLs before making Facebook/Instagram previews clickable.
- Decide whether the club wants email/push alerts or realtime inbox refresh; current updates are in-app and fetched when Staff opens or refreshes Help.
- No cleanup/retention policy currently deletes inquiry records automatically.
