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
})
