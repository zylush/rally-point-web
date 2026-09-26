# Staging pause backup capture guard — TDD evidence

Journey: the release operator can inspect the current backup plan locally;
capture requires separate staging approval and cannot silently reuse the
historical 12-version backup package.

| Guarantee | Test | RED | GREEN |
| --- | --- | --- | --- |
| Local verification pins 13 versions and 617 fingerprint rows without remote capture | `tests/staging-pause-backup.test.ts` | Missing runner: 2/2 failed | 2/2 passed |
| Capture refuses a missing approval guard | Same test | Missing runner: 2/2 failed | 2/2 passed |
| The local plan names the saved PostgreSQL version that capture must enforce | Same test | 1/2 failed after adding the version expectation | 2/2 passed |

`npm test` passed 274/274. `npm run test:coverage` passed 274/274 with
88.85% statements, 81.54% branches, 85.65% functions, and 91.49% lines.
`npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, and
`node --check` passed. The private capture runner's remote mode was not run;
its local guard returned `LOCAL_PASS` with `remoteChecked:false` and
`captureCreated:false`. No database was contacted or changed. The historical
backup package and STOP evidence were not modified. No TDD checkpoint commits
were made because the owner explicitly forbids commits and pushes.

Gap: no fresh capture or disposable restore exists yet. The capture script's
remote path requires separate approval and a full post-capture verification.
