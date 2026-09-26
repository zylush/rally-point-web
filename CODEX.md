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
npx --no-install playwright cli --help
npx --no-install cs-mcp --help
```

Vitest uses jsdom. CSS contract tests live under `tests/`; SQL tests require a prepared local/test Supabase database. `scripts/run-migration.mjs` applies only the first SQL migration, so do not use it as a complete setup or update command. Check the ordered SQL files and target migration history before any database operation.

For browser QA, start the local app with `npm run dev` and use the installed CLI, for example `npx --no-install playwright cli open 'http://127.0.0.1:5173/rally-point-web/#/login'`. Use `npx --no-install playwright cli close` afterward. CLI snapshots and screenshots under `.playwright-cli/` are ignored; do not use Playwright MCP for this repo.

CodeScene Code Health MCP is pinned as a dev dependency and registered in `.codex/config.toml` for this repo. `codex mcp list` confirms the server entry; its first start downloads a platform-specific binary into the ignored `node_modules` cache. Code Health review requires CodeScene account sign-in; do not commit a token or initiate login without the owner's approval.

Verification on 2026-09-20: `npm run build` and `npm run lint` passed; the latest coverage run passed 127 of 127 tests and the 80% thresholds for statements, branches, functions, and lines. The repo-local Playwright CLI opened the local demo login page and captured a snapshot; this is not live Supabase verification. The recent-code refactor scope and results are in `tests/refactor-scope.md`.

## Current boundaries

Live payments are simulated, live reminders are not processed, and the public TV route needs a deliberate live read path. QR rendering uses an external image endpoint, and live QR check-in does not verify the token. These are product/architecture facts to preserve in any proposal; see the limits table in `docs/PRD.md`.

The README GitHub Pages URL and `index.html` social URLs point to different accounts. Verify the actual host before editing deployment URLs or claiming a live check. The dated authorization migration is labelled local/staging only. Do not infer live database state from the presence of migration files.

## Handoff

For a change, name the affected route, page, adapter method, data table/policy, and test in the diff packet described by `docs/CODEX-NAVIGATION-GUIDE.md`. Report checks run, untested boundaries, and any demo/live difference. Keep user changes in the worktree intact unless the user explicitly asks to remove them.
