# Deploying bRineLy on Vercel and Supabase

This runbook covers how bRineLy is hosted, what each setting is for, and how a change goes live. bRineLy is a static site: Vercel builds and serves the React app, and the browser talks straight to Supabase (database, sign-in and photo storage). There is no server of our own.

There are two environments:

| Environment | Deploys from | Supabase project | Data | Address |
| --- | --- | --- | --- | --- |
| Preview | every branch and pull request except `main` | staging, `Rally-Point-Database` (`iclrvvsiwypxlwrwgqia`) | test clubs and synthetic test accounts | the Vercel preview link, with a "Test site" banner |
| Production | `main` | `brinely-production` (`tuttbvwnlndcstmmxybb`) | real clubs and players only | https://brinely.info (also `brinely.vercel.app`) |

Each environment has its own database, sign-in users and Storage. Work is checked on a preview first, and merging into `main` puts it live.

## 1. What runs where

| Part | Where | Purpose |
| --- | --- | --- |
| Web app | Vercel project `brinely` | Builds `npm run build:vercel` into `dist/` and serves it, sending every address to `index.html` (`vercel.json`) |
| Database and API | Supabase (Postgres + PostgREST) | Tables, row-level security and checked `SECURITY DEFINER` functions. The browser calls `/rest/v1/` with the publishable key |
| Sign-in | Supabase Auth | Email and password, with email confirmation |
| Photos | Supabase Storage, buckets `court-photos` and `member-photos` | Created by migrations, with their policies on `storage.objects` |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | Lint, the CI tests and the build on every push and pull request. It never publishes and never touches a database |
| Domain | Squarespace DNS | `brinely.info` and `www` point at Vercel |

```
browser ──https──► Vercel (static app)
browser ──https──► Supabase: /rest/v1 (data), /auth/v1 (sign-in), /storage/v1 (photos)
```

## 2. Before you start

- Access to the Vercel team that owns the `brinely` project, with the GitHub repository connected.
- Access to both Supabase projects. Database work also needs a database password, kept outside the repo.
- Each project's **publishable** key (`sb_publishable_…`), from Supabase → Project Settings → API Keys. Never use a secret or `service_role` key anywhere in this setup.
- For email to real players: a Resend account with `brinely.info` verified, used as custom SMTP in Supabase Auth (see step 5).

## 3. Vercel project settings

`vercel.json` already holds the build settings, so leave the dashboard's build fields on their defaults:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Install command | `npm ci --no-audit --no-fund` |
| Build command | `npm run build:vercel` |
| Output directory | `dist` |
| Production branch | `main` |
| `gh-pages` branch | Never deployed (`git.deploymentEnabled`) |

The `vercel` build mode (`vite.config.ts`) decides the database from `VERCEL_ENV`: production builds must use the production project and every other build must use staging. The build stops if the URL, the key or the base path doesn't match.

## 4. Variables

Set these in Vercel → Settings → Environment Variables, separately for each environment.

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://tuttbvwnlndcstmmxybb.supabase.co` | (from `.env.vercel`: `https://iclrvvsiwypxlwrwgqia.supabase.co`) | Set it for Production. Preview reads it from `.env.vercel` |
| `VITE_SUPABASE_ANON_KEY` | production publishable key | staging publishable key | Must be a publishable key, or a legacy anon key for the same project |
| `VITE_BASE` | leave unset | leave unset | `.env.vercel` sets `/` |

Anything starting with `VITE_` ends up in the browser bundle, so only browser-safe values belong here. The build also sets `VITE_DATA_TARGET` ("Production" or "Staging") itself, and that decides whether the "Test site" banner shows. Don't set it by hand.

## 5. Supabase project settings

For each project, under Authentication:

| Setting | Production | Staging |
| --- | --- | --- |
| Confirm email | On (owner invites depend on it) | On |
| Site URL | `https://brinely.info` | the staging address in use |
| Redirect URLs | brinely.info, www.brinely.info and brinely.vercel.app | the preview addresses in use |
| SMTP | Resend, sender `no-reply@brinely.info` (still to do) | Supabase default |

Without custom SMTP, Supabase sends only a few emails an hour and only to team addresses, and it doesn't allow editing the email templates. Real players can't confirm their accounts until SMTP is set.

Storage buckets, their size and type limits, and their policies all come from the migrations. Don't create or change them in the dashboard.

## 6. Database changes

Migrations reach a hosted database only through a reviewed, owner-approved release, one named migration at a time. Never use `supabase db push`, `--include-all`, the dashboard's SQL editor or the MCP `apply_migration` tool on staging or production, and never run `supabase/seed.sql` there.

**Staging** (`scripts/run-staging-release-apply.mjs`, releases defined in `scripts/club-platform-staging.mjs`):

1. Capture a fresh backup: `scripts/run-staging-backup-capture.mjs --release <id> --capture`.
2. Restore it into a new local database and verify it: `scripts/run-staging-backup-restore-verify.mjs --release <id> --execute-local`.
3. Dry-run the release on the restored copy: `run-staging-release-apply.mjs --release <id> --dry-run-local`.
4. The owner approves the exact manifest SHA-256, which goes into `scripts/staging-release-approvals.mjs`.
5. Apply: `run-staging-release-apply.mjs --release <id> --apply-staging`. Each migration runs in its own transaction, then every postflight check, the reservation-pause audit and the two-club isolation suite run.

**Production** was built once from an empty project with `scripts/run-production-bootstrap.mjs` (43 migrations, 2026-11-28). That script refuses a database that already has data, so it can't apply later migrations. A production release script, following the same pattern as staging (capture, restore check, dry run, owner-approved manifest, apply), still has to be written before the next migration reaches production.

**Order matters.** A frontend change that calls new database functions must merge into `main` only after its migrations are on production. Otherwise the live site calls functions that don't exist yet. Check `supabase/migrations` against production before merging.

## 7. First club and accounts

- **Superadmin**: a trusted operator adds a `platform_roles` row for an account that has already signed up and confirmed its email. Always keep at least one superadmin, and remove temporary ones once the real one exists.
- **Clubs**: the superadmin uses *Set up a club* (`#/superadmin`), which calls the audited `platform_provision_club`. The owner's email becomes the club admin at once if they have a confirmed account. Otherwise an invite is recorded, and they become admin when they sign up and confirm.
- **Staff and coaches**: the club admin adds them. Public sign-up only ever creates players.
- **Booking fee**: the superadmin sets each club's flat fee per booking. Every club starts at PHP 0.

## 8. Domain and DNS

Add `brinely.info` and `www.brinely.info` in Vercel → Settings → Domains, then in Squarespace DNS:

| Record | Host | Value |
| --- | --- | --- |
| A | `@` | `216.198.79.1` (the value Vercel shows) |
| CNAME | `www` | the `…vercel-dns…` host Vercel shows for this project |

Keep the Google Workspace MX, SPF and DKIM records, `resend._domainkey` and `_domainconnect`. Vercel issues the certificate and redirects `www` and plain `http` to `https://brinely.info`.

## 9. Everyday operation

1. Open a pull request. CI runs lint, tests and the build, and Vercel builds a preview against staging, with the "Test site" banner.
2. Check the preview. Staging test logins are kept outside the repo and must never be pasted into the repo, logs or screenshots.
3. If the change needs migrations, release them to staging first, then to production (step 6).
4. Merge into `main`. Vercel builds production and puts it live when the build finishes.

**Rollback:** Vercel → Deployments → pick the last good production deployment → *Instant Rollback*. This rolls back only the web app. A database change is undone with a new migration, never by editing an old one.

## 10. Backups and restore

- **Staging**: every release starts with a capture (`scripts/run-staging-backup-capture.mjs`) of the schema, the data and every stored photo, checked against its record. The capture is restored and verified locally before anything is applied. Captures stay on the release machine under `docs/release-private/`, never in Git.
- **Production**: no backups yet. The Supabase organisation is on the Free plan, which has no automatic backups and pauses idle projects. Before real clubs rely on it, move to a paid plan with daily backups, or add a production capture to the release script.

## 11. Troubleshooting

| What you see | Likely cause |
| --- | --- |
| Vercel build fails with "Production requires the approved brinely-production URL" | Production's `VITE_SUPABASE_URL` is missing or points at staging |
| Build fails with "… requires a browser-safe publishable key" | The key is missing, is a secret key, or belongs to the other project |
| A page on the live site is empty or shows "could not load" after a merge | Its migration isn't on production yet (step 6) |
| "Test site" banner on brinely.info | The deployment wasn't built as Production (`VERCEL_ENV`), so check which deployment the domain points at |
| New players never get the confirmation email | No custom SMTP yet, so Supabase only mails team addresses (step 5) |
| The old site at `zylush.github.io/rally-point-web` still loads | GitHub Pages is still on. Turn it off in the repository's Settings → Pages |
| Chrome warns "Deceptive site ahead" | Ask for a review in Google Search Console → Security issues, with brinely.info verified there |

## 12. Open items (2026-11-28)

- Resend account and custom SMTP for production Auth.
- A production release script for migrations after the bootstrap. Staging has 44 migrations (the flat booking fee), production 43.
- Production backups and leaving the Free plan. The Vercel Hobby plan is for non-commercial use.
- Turning off GitHub Pages.
- Legal review of the Terms of use.
