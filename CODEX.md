# Codex Guide — Rally Point

Read `AGENTS.md` first. For a fast map use `docs/ARCHITECTURE-ESSENTIALS.md`; for details use `docs/ARCHITECTURE.md`; for product scope use `docs/PRD.md`. The repo ownership and PR diff packet are in `docs/CODEX-NAVIGATION-GUIDE.md`.

## Start locally

```bash
npm install
npm run dev
```

The app uses seeded demo mode when either Supabase environment value is blank or absent. `.env.example` shows the variable names. Demo login choices appear on `/login`; the README lists their credentials. For live mode, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a local `.env`. Never commit a service-role key, database password, or payment secret.

## Repo map

- `src/main.tsx` mounts `src/AppRoot.tsx`, which initializes `HashRouter`; `src/App.tsx` defines public and role-restricted routes.
- `src/context/AuthContext.ts` owns the context and hook; `src/context/AuthProvider.tsx` resolves a trusted profile and handles login, member signup, reset request, and logout.
- `src/pages/` contains the member, staff, admin, booking, open-play, schedule, and login screens.
- `src/components/Shell.tsx` and `src/index.css` own shared navigation and responsive layout.
- `src/lib/api.ts` is the frontend data adapter. Follow each method into both `demoStore.ts` and the Supabase calls before changing its contract.
- `src/types.ts` owns domain types, status labels, PHP formatting, and club-hour helpers.
- `supabase/migrations/` owns schema and access policies; `supabase/tests/database/` contains pgTAP checks.
- `public/`, `index.html`, `vite.config.ts`, and `vercel.json` own static assets and hosting behavior.

## Useful checks

```bash
npm test
npm run lint
npm run build
```

Vitest uses jsdom. CSS contract tests live under `tests/`; SQL tests require a prepared local/test Supabase database. `scripts/run-migration.mjs` applies only the first SQL migration, so do not use it as a complete setup or update command. Check the ordered SQL files and target migration history before any database operation.

Verification on 2026-09-19: `npm run build` passed; `npm run lint` produced no warnings; `npm test` passed 38 of 38 tests. Vitest now loads `src/test/setup.ts` through `setupFiles`. The coverage command passed, but overall statement coverage is 29.8%, below the 80% target. Local demo Playwright CLI smoke tests passed for member, staff, and admin routes; this is not live Supabase verification.

## Current boundaries

Live payments are simulated, live reminders are not processed, and the public TV route needs a deliberate live read path. QR rendering uses an external image endpoint, and live QR check-in does not verify the token. These are product/architecture facts to preserve in any proposal; see the limits table in `docs/PRD.md`.

The README GitHub Pages URL and `index.html` social URLs point to different accounts. Verify the actual host before editing deployment URLs or claiming a live check. The dated authorization migration is labelled local/staging only. Do not infer live database state from the presence of migration files.

## Handoff

For a change, name the affected route, page, adapter method, data table/policy, and test in the diff packet described by `docs/CODEX-NAVIGATION-GUIDE.md`. Report checks run, untested boundaries, and any demo/live difference. Keep user changes in the worktree intact unless the user explicitly asks to remove them.
