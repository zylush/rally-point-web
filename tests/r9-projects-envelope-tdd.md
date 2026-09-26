# R9 read-only preflight parser recovery — local TDD record

The first approved remote preflight stopped at 2026-09-24 10:58:51 UTC in
`target-and-pages`: Supabase CLI 2.110.0 returned `{projects, message}` from
`projects list --output-format json`, but the verifier expected an array.
The original STOP SHA-256 is
`e81e21fb8ab2eab0976484a1bcdac7dc49f0fc2f7fc9043efbc5952a6b478837`.
No staging SQL, Pages, hosted-byte, or API-key acceptance step ran.

- RED: new envelope test failed with “Projects response missing.”
- GREEN: parser accepts the exact object shape with an empty message, exactly
  one matching target, and pinned name, status, linked flag, and region. It
  rejects arrays, malformed envelopes, duplicate targets, and nonempty messages
  without echoing private response data. Focused comparison tests: 5/5 passed.
- Saved-response replay: read the original private CLI stdout locally and
  passed the corrected target verifier. No remote request was made.
- RED: new fresh-approval test failed because the guard was absent.
- GREEN: the runner now requires a new local approval guard naming the project,
  latest STOP hash, r9 manifest hash, narrow retry scope, and renewed staging
  pause/session-closure confirmation. Focused preflight tests: 9/9 passed.
  Without that guard, the runner exits in `local-pins` before any remote call or
  evidence-folder creation.

Full local verification after the fix: 240/240 tests, coverage thresholds
(91.04% statements, 81.55% branches, 87.8% functions, 93.82% lines), lint,
typecheck, build, runner syntax, frozen-package check, and `git diff --check`
passed. The original STOP hash is unchanged, and the retry approval guard file
is absent.

The old approval is consumed. The local guard is a safety check, not a source
of authority; a separate explicit user approval is still required. No commit
was made because the release scope forbids commits. Gate 5 remains STOP.
