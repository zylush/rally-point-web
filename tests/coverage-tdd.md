# Coverage TDD evidence

## Scope

No plan file was supplied. Journeys were derived from the existing Rally Point member, staff, admin, booking, payment, QR, open-play, schedule, and authentication flows.

## Guarantees

| Guarantee | Evidence | Type | Result |
| --- | --- | --- | --- |
| Demo storage preserves booking, payment, QR, open-play, reminder, notification, and staff-operation behavior | `src/lib/demoStore.test.ts`, `src/lib/api.demo.full.test.ts` | unit/integration | PASS |
| The screen API is covered in both demo and Supabase-shaped live modes, including query errors | `src/lib/api.live.test.ts` | integration | PASS |
| Member booking checkout reaches confirmation and member QR handles missing membership | `src/pages/remaining-pages.test.tsx` | component flow | PASS |
| Admin member, floor operations, transactions, users, schedule/TV, and booking-desk paths render and mutate through the API boundary | `src/pages/remaining-pages.test.tsx` | component flow | PASS |
| Public signup rejects invalid input, never accepts a client-provided role, and explains email-confirmation signup | `src/context/AuthContext.security.test.tsx` | security/component | PASS |
| Formatting, QR helpers, payment configuration, and simulated checkout remain stable | `src/types.test.ts`, `src/lib/payments.test.ts` | unit | PASS |
| Staff home, member search, QR/manual check-in, court rental, extension, walk-in, and cancel/error states behave as expected; an expired first record is not selected for manual check-in | `src/pages/staff.test.tsx` | component flow | PASS |
| Member open-play join, waitlist, leave, cancelled signup, free game, and staff/admin publish paths behave as expected | `src/pages/OpenPlay.test.tsx`, `src/lib/api.live.test.ts` | component/integration | PASS |
| Member renewal, notifications, payment history, profile fallbacks, and trusted auth failure paths remain covered | `src/pages/member.test.tsx`, `src/context/AuthContext.security.test.tsx` | component/security | PASS |

## Test development and refactor evidence

- The first live-adapter run failed because the Supabase test double was incomplete. This was test setup work, not a business-logic RED result. Production code was not changed.
- The live test double now resets between tests and checks write payloads for member records, bookings, checkout, court status, open-play signups, and QR tokens.
- Page tests now use a member profile for member journeys and verify navigation through a route instead of inspecting the browser hash.
- The first expansion passed 74/74 tests. Staff/open-play and adjacent boundary tests then raised the full suite to 118/118 without changing production code.
- The expanded tests exercise success, denied/error, empty, full/waitlist, cancelled, and fallback states through page actions and the API boundary. Tests use the existing mock API and a resettable Supabase-shaped test double.
- A final staff check-in test failed RED when an expired member preceded an active member (the expired ID was submitted), then passed GREEN after the page selected from its filtered active-member list. The full suite now has 119 tests.

## Verification

| Command | Result |
| --- | --- |
| `npm test -- --reporter=dot --no-color` | 16 files, 119 tests passed |
| `npm run test:coverage` | 119 tests passed; 89.84% statements, 80.54% branches, 87.92% functions, 93.76% lines |
| `npm run lint` | passed with no warnings |
| `npm run build` | TypeScript and Vite build passed |

Vitest now enforces 80% for statements, branches, functions, and lines in `vitest.config.ts`. No Playwright test project is configured in this repository, so no persistent browser E2E tests were added.

## Recent-code refactor follow-up (2026-09-20)

The bounded scope and acceptance criteria are in `tests/refactor-scope.md`. Typed signup and member fixtures replaced duplicate literals in the open-play and staff tests. Eight alternate-state tests were added; no production code changed in this follow-up. A new assertion initially failed because the rendered text was split across elements; the query was corrected to target the visible result, not the markup structure.

`npm run test:coverage` now passes 127 tests at 90.05% statements, 81.51% branches, 88.11% functions, and 93.89% lines. `npm run lint`, `npm run build`, and `git diff --check` pass. CodeScene MCP is installed and reachable, but a Code Health score is pending account sign-in.

Local demo browser QA checked staff check-in and staff open-play at 390px and staff check-in at 1440px: no horizontal overflow, 48px primary controls, and keyboard activation of the check-in tab and open-play form toggle. The member open-play page showed its empty state at 390px. There were no browser console errors. No visual-regression baseline or automated accessibility audit was available; the browser did not exercise join/leave or a real check-in because those mutate demo data.

## DemoStore extraction evidence (2026-09-20)

The source scope is the DemoStore section of `tests/refactor-scope.md`. The journeys are member booking/payment and open-play signup, staff QR/check-in and court sessions, account login/registration, and browser-local state recovery.

| Guarantee | RED evidence | GREEN evidence |
| --- | --- | --- |
| Slot checks preserve active vs cancelled/completed occupancy and ignore a booking's own hold | `npm test -- src/lib/demo/common.test.ts` failed to resolve the not-yet-created helper module | Focused tests passed after the typed helper extraction |
| Legacy storage is normalized without mutating the parsed input, serializing passwords, or retaining an unknown session | `npm test -- src/lib/demo/persistence.test.ts` failed because `normalizeStored` did not yet exist | Focused persistence/auth tests passed after extracting the pure normalizer |
| Booking, QR fallback, waitlist side effects, reminder idempotency, staff session/court state, and the API facade remain stable | Existing `demoStore.test.ts` and `api.demo.full.test.ts` characterized these flows before extraction | Focused tests passed after each domain move; added side-effect and fallback assertions also passed |

Final verification: `npm test` passed 131/131; `npm run test:coverage` passed at 90.40% statements, 82.33% branches, 88.62% functions, and 93.94% lines. `npm run lint`, `npm run build`, and `git diff --check` passed. No browser rerun was needed because this refactor changed no UI or routes. No checkpoint commits were made in the already-dirty shared worktree.
