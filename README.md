# bRineLy

Phone-first pickleball court booking for clubs in the Philippines. Players find a club, book court hours and pay the club directly by GCash. Club staff confirm payments, check members in and run the desk. Club admins manage their courts, prices, members and club page, and a platform superadmin sets up clubs and their booking fee. Currency is PHP and every time is Philippine time.

The repository, the code and some docs still use the earlier name, Rally Point.

## Layout

| Path | Contents |
| --- | --- |
| `src/App.tsx` | Routes and role gates (`HashRouter`, so every address starts with `#/`) |
| `src/pages` | Screens: public site, player, staff, admin, coach and superadmin |
| `src/components` | Shared shell, navigation, footer, photos, banners |
| `src/lib/api.ts` | The data boundary every screen uses. It calls Supabase in live mode and `demoStore.ts` in the demo |
| `src/lib/demoStore.ts` | Seeded browser-only demo data |
| `src/context` | Sign-in, the active club and the person's role |
| `src/types.ts` | Shared types, peso formatting, Philippine time |
| `supabase/migrations` | SQL schema, row-level security, checked functions, Storage buckets and policies |
| `supabase/tests/database` | pgTAP suites, including denied-access checks |
| `supabase/verification`, `scripts` | Release checks, backups and the database runner scripts (some connect to hosted databases) |
| `tests` | Build, release-package and fixture tests |

## Requirements

- Node.js 24 (what CI uses) and npm
- For database work: Docker and the Supabase CLI (`npx supabase`), to run a local Supabase

## Getting started

```sh
npm install
npm run dev
```

The app runs on `http://localhost:5173`. With no Supabase settings it is the **demo**: seeded clubs, courts and bookings kept in your browser, with a "Demo site" banner on every page. These logins work only in the demo:

| Role | Email | Password |
| --- | --- | --- |
| Superadmin | superadmin@brinely.info | superadmin123 |
| Admin | admin@brinely.info | admin123 |
| Staff | staff@brinely.info | staff123 |
| Player | member@brinely.info | member123 |

To use a real database, copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the project's **publishable** key). Never put a `service_role` key, secret key or database password in frontend code or a committed file. A local build that points at a database shows a "Test site" banner. Only Vercel's production build hides it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with reload |
| `npm test` | The full local test suite, including the release-package tests that need this machine's private evidence |
| `npx vitest run --config vitest.ci.config.ts` | The suite CI runs (skips the tests that need local-only files) |
| `npm run lint` | oxlint |
| `npm run build` | Type check and build `dist/` (the demo, with blank settings) |
| `npm run build:vercel` | The build Vercel runs. Refuses a wrong database URL, an unsafe key or a wrong base path |
| `npm run build:staging` | Staging build into `staging-artifact.local/`. Treat it as a hosted operation |
| `npx supabase test db` | The pgTAP suites against a local Supabase |
| `npm run deploy` | Legacy GitHub Pages publish of the demo build. Do not use |

Migrations are SQL files in `supabase/migrations` and are reviewed like code. Never edit one that has been applied to staging or production; add a new one. The 15 September migrations, `supabase/seed.sql`, the 8 original SQL suites and `vitest.config.ts` are hash-pinned and must not change at all.

## Clubs and roles

- **One app, many clubs.** Every club has its own locations (venues), courts, members and staff. Rally Point Gensan is the default club.
- **The active club** travels with each request in an `x-club-id` header. That header only picks the context: access always comes from the person's role in that club, enforced by row-level security and checked database functions.
- **Players** sign themselves up, from the site or from a club's join link (`#/join/<club>`). Staff, admin and coach roles are given by the club (`club_staff_roles`, `staff_venue_grants`). Superadmins come only from `platform_roles`, set up by a trusted operator.
- **Superadmins** work only through audited `platform_*` functions. They set up clubs, invite owners, handle owner call requests, set each club's booking fee and can open a read-only, time-limited support view of one club. They cannot open club screens or change club data.

| Who | What they can do |
| --- | --- |
| Visitors | Welcome page, Find a court (`#/clubs`), club pages with photos, prices, hours and directions, Find a coach, tournaments, the TV schedule board (`#/board/tv/<club>`), List your club, Privacy Notice, Terms of use |
| Players | Book and pay, open play, QR member pass, membership requests, leaderboard, tournaments, coaches, account and photo, notifications |
| Staff | QR check-in, bookings desk and payment confirmation, schedule board, open play, courts, members, help inquiries |
| Club admins | Overview and analytics, courts, locations and photos, club profile (hours, add-ons, coaches, payment methods, gallery), members, users, transactions, platform fees |
| Coaches | Coach portal for lesson requests |

## Booking and payments

bRineLy never receives or holds players' money, and it has no payment provider.

- **Holding hours**: a player picks one or more hours on one court (ending by midnight). They are held for 15 minutes while the player pays, and starting a new checkout gives back the player's previous unpaid hold.
- **Paying**: the player pays the club's own GCash QR code or number, shown with the club's account name, then types the GCash reference. One reference can pay for only one live booking per club.
- **Confirming**: the club's staff or admin check the payment and confirm it, which books the hours and records the charge. Or they reject it with a reason. A payment that has been sent never lapses, while an unpaid hold lapses after 15 minutes and leaves the TV board.
- **Refunds**: the app cannot cancel or refund a confirmed booking, and checkout says so before payment. Any refund is between the player and the club.
- **Platform fee**: the superadmin sets a flat peso fee per booking for each club (every club starts at PHP 0). It is recorded against the club when staff confirm a booking or a desk rental, never added to the player's price, and never more than the charge.
- **Memberships**: a player asks a club for a membership, and staff approve it (30 days) and record the amount received. Courts can have a member rate, which so far only the demo charges.

## Being honest with visitors

- Every build except production shows a banner that can't be closed: "Demo site" for the browser demo, "Test site" for staging and Vercel previews (`src/lib/dataMode.ts`, `src/components/DataModeBanner.tsx`).
- Checkout names the club that receives the money and asks the player to check the account name.
- A club or court without its own photos shows a stock photo labelled "Sample photo" (credited under `#/privacy#photo-credits`).
- The Terms of use (`#/terms`) and Privacy Notice (`#/privacy`) are linked from every public page. Both are written in plain language, and the terms still need a legal review before they are final.

## Design rules

- About 430px phone layout with bottom navigation per role, plus a desktop sidebar and a readable content column.
- Plain English, large type, high contrast and touch targets of at least 48px, for players of every age.
- Brand assets live in `public/`, and `src/components/BrinelyLogo.tsx` draws the logo.
- Browser checks use the repo-local Playwright CLI (`npx --no-install playwright cli`) against `npm run dev`.

## Deployment (Vercel and Supabase)

The full runbook is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): environments, variables, the Supabase settings, database releases, the domain, backups and troubleshooting.

| Environment | Built from | Database | Address |
| --- | --- | --- | --- |
| Production | `main` | Supabase `brinely-production` | https://brinely.info |
| Staging | `staging` (Vercel project `brinely-staging`) | Supabase staging (`Rally-Point-Database`) | https://brinely-staging.vercel.app, with a "Test site" banner |
| Preview | every other branch and pull request | Supabase staging (`Rally-Point-Database`) | the Vercel preview link (Vercel sign-in), with a "Test site" banner |

GitHub CI runs lint, the CI tests and the build on every push and pull request, but it never publishes and never touches a database. Vercel builds and publishes. Every change goes through `staging` first: pull requests target `staging`, a merge there updates the staging site, and only then does a pull request from `staging` into `main` put it live. Database migrations reach staging and production only through reviewed, owner-approved release packages, never through `supabase db push`, so a change that needs new migrations merges only after they are on production.

## More documentation

- [`AGENTS.md`](AGENTS.md): rules for every coding agent in this repo
- [`CLAUDE.md`](CLAUDE.md): the Claude Code guide and a dated record of what runs where
- [Documentation index](docs/README.md) and the [Help and inquiry workflow](docs/HELP-AND-INQUIRY-WORKFLOW.md)
