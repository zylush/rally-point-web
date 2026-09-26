# Booking desk load race: local TDD evidence

Date: 2026-09-23. Source: owner request to fix the booking-desk loading/error race locally and rebuild the privacy release package. Scope: React booking desk, deterministic component tests, and local package; no database change, deployment, or enforcement.

## Journeys and guarantees

| Journey | Regression in `src/pages/remaining-pages.test.tsx` | RED | GREEN |
| --- | --- | --- | --- |
| Staff opens bookings with one accessible venue | Wait for venue access, make exactly one venue-scoped booking request, show the result | Two requests, including an unscoped first read | One request with the selected venue ID |
| Staff switches venues while a read is pending | Show the newly selected venue; ignore a later failure from the old request | Old result interfered with the selected view | Old request cannot change the current view |
| Staff recovers from a failed venue read | A successful read after switching clears the prior error | Error persisted | Current venue rows replace the error |
| Staff quickly switches away and back | Show a fresh pending state until the retry completes | Prior error resurfaced during retry | Request number distinguishes the new load |
| Staff has no accessible venues | Show the empty state without querying all club bookings | Unscoped booking read occurred | No booking request |

The tests use controlled promises for venue and booking reads, including out-of-order completion. They make no Supabase connection. The original one-time error test remains and is green.

## Observed checks

- `npm test -- src/pages/remaining-pages.test.tsx`: RED, four initial regressions failed for the intended behavior; after the first fix, 14/14 passed. A new rapid-return test then reproduced the cached-error race (1 failed, 14 skipped). After request numbering, 15/15 passed.
- `npm test`: 22 files, 179 tests passed.
- `npm run test:coverage`: 22 files, 179 tests passed; 90.12% statements, 80.44% branches, 86.42% functions, 92.82% lines. Booking desk: 97.82% statements, 90.16% branches, 92.85% functions, 97.29% lines.
- `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, `git diff --check`: passed. `npm audit --audit-level=high`: zero vulnerabilities.
- Repo-local Playwright CLI on a local demo build at `127.0.0.1:5187`: staff signed in and opened `/#/staff/bookings`; phone 390x844 and desktop 1440x900 screenshots visually inspected (`.playwright-cli/page-2026-09-23T09-22-03-999Z.png` and `page-2026-09-23T09-22-18-219Z.png`). Phone document width equalled viewport width (390px). Tab focused the desktop Home link with a solid outline. No browser console errors. The CLI browser and preview server were closed.

The demo has one venue and no booking rows in this browser check, so it does not visually exercise the multi-venue picker or live database permissions. Component tests cover the picker and request ordering; hosted acceptance remains separate.
