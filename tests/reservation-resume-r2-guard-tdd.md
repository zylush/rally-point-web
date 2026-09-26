# Gate 2/3 r2 local guard correction

Scope: local-only correction and regression tests. No Docker, PostgreSQL, staging, Pages, or production contact; no rehearsal, migration, commit, or push. The consumed r1 executor, ATTEMPT, STOP, and frozen migration package were not edited.

The member journey is release safety: an operator must connect only to the intended local PostgreSQL cluster before a disposable replay can create data. The r2 candidate obtains a cluster reference through `docker exec ... psql` on the container's Unix socket, compares it with the TCP server's cluster ID, data directory, start time, role, database, version, and address, and allows the exact IPv4 or `/32` spelling. Other addresses, malformed masks, wrong clusters, or other clients fail closed. Its port guard requires an exclusive `127.0.0.1:54322` Docker binding.

| Guarantee | RED evidence | GREEN evidence |
| --- | --- | --- |
| `/32` is accepted without accepting a different address or mask | Focused Vitest: `172.18.0.2/32` failed with `Connection is not the approved local container` | 32 r2 tests passed |
| A different socket/host cluster, start time, data directory, role, port, or client is rejected | Initial r2 scaffold returned socket data unchecked; focused Vitest failed the malformed-socket cases | 32 r2 tests passed |
| Broad or ambiguous Docker bindings are rejected | Focused Vitest failed three `0.0.0.0`/`::` cases after test-harness correction | 32 r2 tests passed |
| Consumed evidence and source remain pinned | r2 runner did not exist; focused static test failed | r2 offline check verified preserved hashes and frozen 38-file package |

Verification: focused r2+r1 executor suites passed 82/82; full `npm test -- --maxWorkers=1` passed 517/517 across 46 files; `npm run test:coverage -- --maxWorkers=1` passed 517/517 with statements 88.17%, branches 83.46%, functions 86.73%, lines 90.5% (configured 80% thresholds unchanged). After the final consumed-diagnostic hash check was added, the focused 82 tests, `node ...r2-local.mjs --verify-local`, lint, `npx --no-install tsc --noEmit`, and build passed again. The final hash-only addition did not rerun the full suite or coverage.

Limitations: no database integration or concurrent reservation run occurred. The last observed Docker binding was `0.0.0.0:54322` and `[::]:54322`; it will fail the r2 exclusive-loopback guard. Rebinding or accepting that exposure requires separate owner direction. A new one-shot disposable-local rehearsal requires separate approval and a fresh target/absence check. The r2 package hashes are in the private preparation manifest; the intended r2 attempt folder remains absent.
