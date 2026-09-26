# Disposable Gate 2/3 executor — local evidence and STOP

Scope: the owner's approval covered one new, loopback-only rehearsal against three exact disposable database names. It did not authorize staging, production, deployment, commits, or pushes.

The executor and probes were added separately from the frozen 38-file reservation-resume package. They bind PostgreSQL to `127.0.0.1:54322`, check the Docker Desktop named-pipe context and pinned image, reject all application databases except the three approved names, check absence of all three before creation, and have no drop/reset/retry path. The run is one-shot: an existing evidence folder blocks execution.

TDD evidence:

| Guarantee | RED | GREEN |
| --- | --- | --- |
| Exact targets, credentials, absence, one-shot semantics, strict TAP | Focused Vitest failed because the guard module did not exist | 41 focused tests passed |
| Local-only Docker endpoint | Two focused tests failed for missing endpoint guard | 49 focused tests passed |
| Known UUID setup output with strict TAP rejection | One focused test failed on valid setup output | 50 focused tests passed |

Sequential verification before the one-shot attempt: full `npm test -- --maxWorkers=1` passed 484/484 across 45 files; `npm run test:coverage -- --maxWorkers=1` passed 484/484 with global statements 88.08%, branches 83.35%, functions 86.68%, lines 90.42% (configured 80% thresholds unchanged). `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, frozen-manifest verification, and `git diff --check` passed. The final TAP parser change was rechecked by the 50 focused tests; the full suite and coverage were not rerun afterward. Database integration paths are not covered by the unit suite and remain unverified.

One approved execution began at 2026-09-26 07:44:30 UTC. It recorded `ATTEMPT.json`, verified the Docker Desktop context and image, then stopped in `maintenance-identity` because the database server address was not found in the inspected container-address list. This is a fail-closed guard result; the actual address and its cause have not been reconciled. Control flow stopped before the database-absence query or any `CREATE DATABASE`. No migration, fixture, RPC grant, concurrency test, or clean replay ran. Do not reuse the consumed attempt or edit its pinned source in place.

Preserved evidence: `docs/release-private/reservation-resume-gate23-20260926-r1/ATTEMPT.json` SHA-256 `199e3964e72d5f0d32cd438c5b97b04c7080bf00b58cfae14771b43cba70bcd9` and `STOP.json` SHA-256 `b7db0a77d199959df7d0d5b537fe307cfe16d4c885f9c26737d598f30104f344`.

Next safe step requires separate approval for read-only local address/target reconciliation. Preserve the STOP and use a new private package for any correction or new attempt. Gates 2 and 3 remain incomplete; staging remains paused.

## Self-evaluation

Summary: 3.6/5 across accuracy, completeness, clarity, actionability, and conciseness.

| Axis | Score | Evidence and improvement |
| --- | ---: | --- |
| Accuracy | 4/5 | The exact STOP and no-create control flow are evidenced; the endpoint mismatch is not yet explained. Reconcile addresses read-only before attributing cause. |
| Completeness | 2/5 | The one-shot run stopped before migration-order, authorization, concurrency, and replay checks. A separately approved fresh package is needed after diagnosis. |
| Clarity | 4/5 | Evidence separates local checks from database results; the exact networking term may need a plain-language explanation in the handoff. |
| Actionability | 4/5 | The next narrow approval is identified; it should name the diagnostic-only commands and explicitly exclude retry. |
| Conciseness | 4/5 | The evidence report is compact, though the safeguard list overlaps with the runbook. |

Critical issue: completeness 2/5 — no database rehearsal result exists. Top improvement: identify the local proxy/container address relationship without mutation, then build a new guarded executor; never edit or rerun the consumed attempt. Self-check: the owner should agree that a fail-closed STOP is safer than asserting the gates passed.
