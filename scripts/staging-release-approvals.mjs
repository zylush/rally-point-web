// Owner approvals for staging releases: release id -> the manifest SHA-256 the
// owner approved (run-staging-release-apply.mjs --verify-local prints it).
// null means not approved. This is the only release input the manifest does not
// pin, so it holds nothing but these values.
export const releaseApprovals = Object.freeze({
  // Owner, 2026-10-17, after the dry run passed: "Approve and apply". Applied the same day.
  'advisor-fixes-20261017': '323fad33293298bc12f7cd2bf2300502a17e13b3d981f965dc5c17a3574cb5d9',
  // Owner, 2026-10-17, after the second dry run passed: "Approve and apply".
  'advisor-followup-20261017': '611863752244ae494e21bf3fad63a97eee3d2b7cdc24fcd847436bb99f645ee0',
  // Owner, 2026-10-22: "do the staging release and publish the staging site". Recorded after the
  // dry run on a restored copy of staging passed (all checks, isolation 55/55, schema matches the build).
  'court-marketplace-20261022': '4e319844304d280c91fdda969c4e2c06285b0e4f4c3b80513ebe0d33f1c454d3',
  // Owner, 2026-10-23, after the dry run on a restored copy of staging passed (all checks,
  // isolation 55/55, schema matches the build): "approve and reply" (meaning approve and apply).
  'court-photos-20261023': 'eaa57596f08f0cbade1b094ce43b9cb1e61c9240db3756eec7bd86aa6e0a0dab',
  // Owner, 2026-11-16 (PH), after the capture, the r2 restore check and the dry run on a restored
  // copy of staging passed (all checks, isolation 55/55, schema matches the build): "yes".
  'club-profile-20261115': '2361081b6e4e958f4a7ff92e524d2b1f7051f9d8329f89092dbf6b257b1eb10f',
  // Owner, 2026-11-16 (PH), after the capture (r2), the restore check and the dry run on a restored
  // copy of staging passed (all checks, isolation 55/55, schema matches the build): "Approve and apply".
  'owner-onboarding-20261116': 'ae14186dfa94b95ef07df79e4a0f6c41b4de40ceeac2abc97af211d59a73cd41',
  // Owner, 2026-11-22 (PH): "approve", given while the capture ran, on the condition that the
  // capture, the restore check and the dry run on a restored copy of staging all pass. They did
  // (all checks, isolation 55/55, schema matches the build). It also lets members write bookings
  // through the five checkout functions.
  'member-gcash-checkout-20261122': '0646d001621961f753e7ed66350c702e4d07280d1a8f0b492ac4a26ebfa95b24',
  // Owner, 2026-11-24: "do the staging release for the migrations". Recorded after the capture
  // (staging-backup-20261124-r1), the restore check and the dry run on a restored copy of staging
  // passed (all checks, isolation 55/55).
  'member-codes-booking-length-20261124': '6eeb2efcafb9ac41a7a401656ec0557f1bc2a96bcf3eb116dc689ff1ab7233e2',
  // Owner, 2026-11-24: "yes do that" (fix the rent-a-coach migration and release it). Recorded after
  // the capture (staging-backup-20261124-r2), the restore check and the dry run on a restored copy of
  // staging passed (all checks, isolation 55/55, schema matches the build).
  'rent-a-coach-20261124': '38e6e692210d12f46e55ccf648a017c1cb76441fb1257f95aed0b58c4e4e7425',
  // Owner, 2026-11-25: "yes commit and open a pull req and merge, then do a staging release".
  // Recorded after the capture (staging-backup-20261125-member-account-r1), the restore check and
  // the dry run on a restored copy of staging passed (all checks, isolation 55/55, schema matches the build).
  'member-account-20261125': 'ff18291722b2374a391972cc04bb3a263378e5c77124a45cf735b5813cbd490a',
  // Owner, 2026-11-24: "yes, and yes on step 6" (step 6 of the dashboards plan: the server summary
  // functions and their staging release); 2026-11-25, after the capture (staging-backup-20261125-r2),
  // the restore check and the dry run on a restored copy of staging passed (all checks, isolation
  // 55/55): "Apply to staging".
  'dashboard-analytics-20261125': '7fd2ff1af880d7e33d0d34aac4757d6e899fc4ebfe440c95e31924b4c84788c8',
  // Owner, 2026-11-26: "yes" to preparing it (renumber, capture, restore check, dry run), then, after
  // the all-clubs tournaments migration was added and the capture (staging-backup-20261126-r1), the
  // restore check and dry run r2 on a restored copy of staging passed (all checks, isolation 55/55,
  // local build matches): "go ahead".
  'leaderboard-tournaments-20261126': '47ffbe474641bc6c22b40a089a59a500f4857e47eafa281dc7bcbedf7f11296e',
  // Owner, 2026-11-26: "go ahead" to fixing the review points (capture, restore check, dry run);
  // after the capture (staging-backup-20261126-fixes-r1), the restore check and the dry run on a
  // restored copy of staging passed (all checks, isolation 55/55, local build matches), chose
  // "Apply to staging".
  'tournament-fixes-20261126': '36fe1cb23863ddd78d7827a3a345abdbc7622d16d7d8146152590646828cc0b5',
  // Owner, 2026-11-26: indoor and outdoor courts (label, filters, counts; existing courts not set;
  // prices per court), released together with PR #33's public coaches migration. After the capture
  // (staging-backup-20261126-court-types-r1), the restore check and the dry run on a restored copy of
  // staging passed (all checks, isolation 55/55, local build matches), chose "Apply to staging".
  'coaches-court-types-20261126': '00b1ec38b08c54f1bcc115e7e9521c499804b952fdb1d99643d7fbaea10a4d26',
})
