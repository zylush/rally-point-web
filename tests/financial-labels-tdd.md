# Live financial-label regression evidence

Date: 2026-09-23. Local release-readiness correction following the r7 financial-label STOP. No database changes or hosted acceptance are part of this test.

The live UI must describe unverified transaction amounts as recorded charges, keep renewal at the desk, and avoid advertising online checkout. Demo simulation retains its existing payment labels and behavior.

## RED / GREEN

- Added seven component regressions in `src/pages/financial-labels.live.test.tsx` with live mode, controlled API responses, and an unverified charge. The initial run failed 7/7 on the old live wording.
- Changed member home/activity, renewal, admin dashboard/ledger, and login/signup copy according to live versus demo mode. No payment command, API, permission, or database behavior changed.
- The first post-fix run passed 6/7; the remaining test reached a duplicated Join as member button. Selecting the mode button by its `pressed: false` accessibility state removed the query ambiguity.
- Focused financial-label and booking-desk suites: 22/22 passed. The renewal test also proves there is no Pay button and no membership-payment call.
- Full suite: 189/189 across 23 files passed. Coverage: statements 90.12%, branches 81.03%, functions 86.42%, lines 92.82%; all configured 80% thresholds pass.
- Lint, TypeScript check, ordinary build, and diff whitespace checks pass. Dependency audit reports zero vulnerabilities.

## Browser evidence and limits

Repo-local Playwright CLI used the ordinary local demo build at `http://127.0.0.1:5187/rally-point-web/`. Staff demo login and booking-desk empty state passed. Phone 390x844 and desktop 1440x900 screenshots were visually inspected (`.playwright-cli/r8-demo-bookings-phone.png`, `r8-demo-bookings-desktop.png`). Phone document/viewport widths both equal 390px. Home link has a solid focus outline; Enter navigates to staff home. Browser console: zero errors and warnings.

This does not prove hosted acceptance or live permissions. The demo browser has one venue and no bookings; multi-venue timing is exercised by deterministic component tests, and live financial labels by the mocked live-mode tests. No pixel-diff baseline, screen-reader audit, or Core Web Vitals measurement was performed.
