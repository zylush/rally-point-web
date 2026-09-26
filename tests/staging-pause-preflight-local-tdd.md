# Staging pause dry-run preflight: local guard evidence

Source: the approved pause-only staging dry-run scope and the 2026-09-25 local STOP. This turn was local-only; no staging dry run was attempted.

Operator journey: before using the isolated pause package against staging, detect any change in the canonical public-schema fingerprint rather than accepting merely a 32-character marker and a large row count.

| Guarantee | Evidence | Result |
| --- | --- | --- |
| The saved 617-row fingerprint is hash-pinned, with marker `7f18a8fafb767f4fdd1a5a37401a6471` | `node scripts/run-gate1-fingerprint-readonly.mjs --verify-local` | PASS, local only |
| Current fingerprint must match every saved row and the exact marker; altered function detail, marker, or row count is denied without echoing private details | `tests/r9-readonly-compare.test.ts` | PASS |
| A future approved read-only run checks the fingerprint both before and after its baseline queries | `scripts/run-gate1-fingerprint-readonly.mjs` reviewed; remote branch not executed | Prepared, not remotely verified |
| Historical backup-reference files remain intact | Local SHA-256 comparison against `capture_manifest.json` (65 entries) and `catalog_retry_verification_manifest.json` (69 entries) | 0 mismatches; historical backup only |
| Pause-only package still excludes enforcement | `node scripts/reservation-pause-package.mjs --verify` | PASS, 18 files |

RED: `npm test -- tests/r9-readonly-compare.test.ts` ran 6 tests; the new exact-fingerprint case failed because `verifyCanonicalFingerprint` was absent. GREEN: targeted comparison/candidate tests passed 16/16; full `npm test` passed 272/272 across 33 files. `npm run test:coverage` passed 272/272; global statements 88.85%, branches 81.54%, functions 85.65%, lines 91.49%. Lint, typecheck, build, and `git diff --check` exited 0. No commits were made.

Limits: The local file checks cannot establish that staging is currently unchanged or paused. The saved backup was captured and restored in September 2026 but is not a new backup. A fresh scoped approval and required CLI filesystem/network permissions remain necessary before read-only staging checks and the isolated CLI dry run. The original STOP SHA-256 remains `BBC97E2B7FD6141763E76A1E9D28055CD7A14AB4B543FFF6CC453E0E29A19DD9`.
