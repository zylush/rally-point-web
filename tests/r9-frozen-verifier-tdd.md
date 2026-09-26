# Frozen r9 verifier: local correction evidence

Source: the 2026-09-25 staging dry-run STOP at `docs/release-private/staging-reservation-pause-dryrun-20260925-182447/STOP.json` (SHA-256 `BBC97E2B7FD6141763E76A1E9D28055CD7A14AB4B543FFF6CC453E0E29A19DD9`).

Operator journey: verify the already-frozen r9 app artifact during a later reservation-pause migration check without treating a new source-only migration as a change to r9. The build-time `--verify` mode must still reject current-source drift. Neither mode may contact staging or disclose the browser key.

| Guarantee | Test/evidence | Result |
| --- | --- | --- |
| Frozen r9 files, r8 browser-key lineage, target, and manifest are verified without comparing the later source tree | `tests/r9-app-candidate.test.ts` frozen-candidate subprocess case; `node scripts/verify-r9-readonly-local.mjs` | PASS |
| Strict build-time source comparison remains intact and rejects the post-freeze pause migration | Same test's `--verify` subprocess case | PASS (expected rejection) |
| Staging fingerprint local pins no longer fail on that unrelated post-freeze source change | `node scripts/run-gate1-fingerprint-readonly.mjs --verify-local` | PASS: 13 applied versions expected; no remote call |
| Pause-only migration package was not changed by this correction | `node scripts/reservation-pause-package.mjs --verify` | PASS: 18 files, enforcement excluded |

RED: `npm test -- tests/r9-app-candidate.test.ts` ran 10 tests: 2 failed for the intended old behavior (unknown `--verify-frozen`; nested local gate rejected r9 verification), 8 passed.

GREEN: `npm test -- tests/r9-app-candidate.test.ts tests/r9-readonly-preflight.test.ts` passed 19/19. Full `npm test` passed 270/270 across 33 files. `npm run test:coverage` passed 270/270 with global statements 88.84%, branches 81.50%, functions 85.75%, lines 91.44%. `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, and `git diff --check` exited 0. No checkpoint commits were made because commits/pushes remain outside this approval.

Scope limit: this is local verifier preparation only. No staging, Pages, Auth, browser, or production contact; no dry run or migration application. A fresh scoped approval and required CLI filesystem/network permissions are still needed for the stopped staging dry run. The historical backup reference is not a fresh backup.
