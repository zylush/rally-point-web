# Rally Point — Agent Instructions

## Product and source of truth

Rally Point Gensan is a phone-first pickleball court rental and membership app for members, staff, and admins. Currency is PHP. Read `docs/ARCHITECTURE-ESSENTIALS.md` for the short implementation map, `docs/PRD.md` for current product scope and open release decisions, and `docs/ARCHITECTURE.md` for data flows. `CODEX.md` and `docs/CODEX-NAVIGATION-GUIDE.md` cover repo navigation and handoff.

The client Figma UI/UX file and whiteboard are external design sources; they are not checked into this repo. Do not invent decisions from them.

## Stack and modes

Vite, React, TypeScript, Tailwind v4, React Router `HashRouter`, and Supabase. `src/lib/api.ts` is the screen-facing data boundary. With blank or missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`, `src/lib/supabase.ts` selects the seeded `src/lib/demoStore.ts` browser demo. Never make empty environment values crash startup. Demo state is browser-local and must not be mistaken for live data.

## Non-negotiables

- Keep the mobile shell at approximately 430px, with role-specific bottom navigation. Preserve the desktop sidebar and readable content rail.
- Use plain English, large legible type, high contrast, familiar status words, and touch targets at least 48px (prefer 52–56px). Players span age groups.
- Keep member, staff, and admin route boundaries intact. In live mode, rely on trusted `profiles` data and database RLS/grants; client guards alone do not authorize data access.
- Public signup is member-only. Staff/admin accounts require trusted provisioning. Do not put authorization roles in user-editable signup metadata.
- Never put service-role, payment-secret, or database passwords in frontend code or committed files. Use local environment variables and publishable browser keys only.
- Treat checkout, membership renewal, reminders, QR verification, and public TV data as documented in `docs/PRD.md`; do not present scaffold or simulated flows as production complete.
- Do not apply migrations or change live data without an explicit task and a verified target. The dated authorization migration says local/staging verification first.

## Where changes belong

| Concern | Files |
| --- | --- |
| Routes and role gates | `src/App.tsx`, `src/context/AuthContext.ts`, `src/context/AuthProvider.tsx` |
| Pages | `src/pages/*` |
| Shared shell and design tokens | `src/components/Shell.tsx`, `src/index.css` |
| Types and formatting | `src/types.ts` |
| Demo/live data behavior | `src/lib/api.ts`, `src/lib/demoStore.ts`, `src/lib/supabase.ts` |
| Payment placeholder | `src/lib/payments.ts` |
| Schema, RLS, Auth hooks | `supabase/migrations/*`, `supabase/config.toml` |
| Tests | Adjacent `*.test.ts(x)`, `tests/*`, `supabase/tests/database/*` |

When changing a data operation, inspect both demo and live branches and the matching SQL policy. When changing a user journey, inspect its route, page, adapter call, state change, and result screen. Preserve unrelated local edits.

## Verification

Run proportionate checks: `npm test`, `npm run lint`, and `npm run build` for code changes. Check affected phone and desktop layouts and keyboard interactions for UI changes. Database policy changes need local/test SQL checks, including denied access. Report what actually ran and what remains unverified. Review the diff before any commit or push; deployment and third-party changes require explicit authorization.

For browser checks, use the repo-local Playwright CLI (`npx --no-install playwright cli`), not Playwright MCP. Run it against the local demo or an authorized test environment, and close CLI sessions when done.
