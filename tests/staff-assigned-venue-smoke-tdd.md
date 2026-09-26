# Next staff smoke verifier — local-only preparation (2026-09-24)

Purpose: replace the ambiguous combined `Staff sees another venue` browser assertion from the preserved 09:29 Gate 5 STOP. This is a source-only script for a future, separately approved Playwright CLI run-code package; it has **not** contacted Pages or staging and has not been run in a browser.

Journey: an already authenticated synthetic Rally staff account opens court operations and bookings, sees the assigned fixture venue/court only, and makes no unscoped court, session, or booking GET. The check also requires the approved staging Supabase origin, safe phone/desktop widths, a visible focus indicator, and no page/API errors.

| Failure class | Deterministic local test |
| --- | --- |
| Foreign court label | Separate `Unassigned court visible` error |
| Extra venue option | Separate `Extra venue option` error |
| Unexpected venue API rows | Stops before court UI assertions |
| Unscoped operational GET | Stops, including extra GETs beyond the expected reads |
| Wrong Supabase project | Stops for venue and operational GETs even when paths match |

TDD: the first run was RED because the verifier implementation was absent; after implementation 4/4 tests passed. A wrong-backend negative test then failed as intended and passed after origin checks were added. An extra unscoped-GET negative test likewise failed as intended and passed after all observed operational reads were checked. Final `node --test tests/staff-assigned-venue-smoke.node-test.mjs`: 6/6 passed. `node --check`, `npm run lint`, `npm test` (213/213), and `npm run build` passed. The old STOP SHA-256 remained `335ea14df0261efc4d3c35b747b6b545d0401b1842b7491a198b4bc3bea8b823`.

Current script SHA-256: `dce653f349aa3ea2e7840c8cadc258f5ab1aaa09fb027f5784315179195a10dd`. Current test SHA-256: `e1447a3f82a5265a80a4cca975470e81998d22a4a7e244a0d61f20476fcc46e9`. These are identification hashes, not a frozen release package.

Still required: a credential-backed new staging app artifact and exact-byte freeze, explicit publication approval, a separately approved authenticated browser run, and read-only Auth/operational postflight. The hosted r8 build remains unchanged and Gate 5 remains stopped. No migration, enforcement, staging activity resume, commit, push, or production work occurred.

Self-evaluation: accuracy 4/5 (local fake-page tests do not prove live Playwright CLI behavior); completeness 4/5 (the script is not yet integrated into a frozen release package); clarity 5/5 (each failure has a distinct reason); actionability 4/5 (new artifact and separate approval are needed); conciseness 4/5 (the verifier includes some repeated route checks). Overall 4.2/5; no critical issue. Highest-impact improvement is a separately approved hosted run with exact-byte and Auth postflight guards. The user should agree because this report does not claim a browser or Gate 5 pass. Verdict: deliver as local preparation only.
