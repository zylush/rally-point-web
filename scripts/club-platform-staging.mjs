// Shared, guarded plumbing for staging releases: the release definitions, the
// staging target, the owner's password file, psql through the local Supabase
// container, read-only JSON queries, and the backup and approval checks.
// The password is passed only to child processes as an environment variable;
// it is never written, logged, or included in errors.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { defaultAclSupplement } from './restore-catalog-checks.mjs'
import { planRestoreData } from './restore-data-checks.mjs'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const project = 'iclrvvsiwypxlwrwgqia'
export const passwordFile = 'C:/Users/ed/.rally-point/staging-db-password.local'
export const dockerExe = 'C:/Users/ed/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
export const supabaseCli = 'C:/Users/ed/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
export const container = 'supabase_db_rally-point-web'
export const localImage = 'public.ecr.aws/supabase/postgres:17.6.1.147'

// The owner approved this package on 2026-10-17 ("Approve, run after backup"):
// it may be applied only after a fresh capture has been restored and verified.
export const approvedManifestSha256 = '70a9287ddc74937e12fa83e99d856e0be6595070a1af906e388fb5723dcb7918'

export const expectedStagingVersions = Object.freeze(['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828', '20260922011918', '20260922163027',
  '20260922163830', '20260922164128', '20260923053440', '20260925174111'])

// Releases the capture, restore and apply scripts can run, each with its own
// one-shot evidence folders. The club platform release (applied 2026-10-17)
// is complete; it ran the versions of those scripts in commit b79f264.

// Applied 2026-10-17 and kept for the record. Its manifest pins files that later
// releases changed and staging has moved past its baseline, so its gates now refuse it.
export const advisorFixesRelease = Object.freeze({
  id: 'advisor-fixes-20261017',
  title: 'Supabase advisor fixes',
  baseVersions: Object.freeze([...expectedStagingVersions, '20260921111105', '20260927105500', '20260928170000',
    '20261017090000', '20261017090100', '20261017090200', '20261017090300'].sort()),
  migrations: Object.freeze(['20261017160000_supabase_advisor_fixes.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261017160000_supabase_advisor_fixes.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor', ignore: Object.freeze([]) }),
    // The club postflight insists on exactly 21 migrations; this release adds the 22nd.
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261017-r2',
    restore: 'docs/release-private/staging-backup-restore-20261017-r2',
    dryRun: 'docs/release-private/advisor-fixes-staging-dryrun-20261017-r1',
    apply: 'docs/release-private/advisor-fixes-staging-apply-20261017-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261017_r2_restore', dryRun: 'rally_staging_backup_20261017_r2_dryrun' }),
})

export const advisorFollowupRelease = Object.freeze({
  id: 'advisor-followup-20261017',
  title: 'Supabase advisor follow-up',
  baseVersions: Object.freeze([...advisorFixesRelease.baseVersions, '20261017160000']),
  migrations: Object.freeze(['20261017170000_supabase_advisor_followup.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261017170000_supabase_advisor_followup.sql',
    'supabase/verification/supabase_advisor_followup_postflight.sql', 'supabase/verification/supabase_advisor_postflight.sql',
    'supabase/verification/club_platform_postflight.sql', 'supabase/verification/two_club_isolation.sql',
    'supabase/verification/schema_fingerprint.sql', 'supabase/verification/backup_content_inventory.sql',
    'supabase/verification/reservation_write_pause_readonly.sql', 'supabase/verification/staging_privacy_readonly_preflight.sql',
    'scripts/run-staging-release-apply.mjs', 'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs',
    'scripts/restore-catalog-checks.mjs', 'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup', ignore: Object.freeze([]) }),
    // Written for 22 migrations with the schedule board still a definer view; this release changes both.
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261017-r3',
    restore: 'docs/release-private/staging-backup-restore-20261017-r3',
    // r1 stopped: hosted staging lets service_role read the views; the migration now keeps that.
    dryRun: 'docs/release-private/advisor-followup-staging-dryrun-20261017-r2',
    apply: 'docs/release-private/advisor-followup-staging-apply-20261017-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261017_r3_restore', dryRun: 'rally_staging_backup_20261017_r3_dryrun2' }),
})
// Court management, the public club list and players without a membership, venue
// locations, 24-hour booking and Philippine time. admin_upsert_court is a narrow
// admin-only court write path; the reservation-write pause itself stays in force.
export const courtMarketplaceRelease = Object.freeze({
  id: 'court-marketplace-20261022',
  title: 'Court management and player marketplace',
  baseVersions: Object.freeze([...advisorFollowupRelease.baseVersions, '20261017170000']),
  migrations: Object.freeze(['20261022090000_admin_court_management.sql', '20261022100000_player_marketplace.sql',
    '20261022110000_open_all_day_ph_time.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261022090000_admin_court_management.sql',
    'supabase/migrations/20261022100000_player_marketplace.sql', 'supabase/migrations/20261022110000_open_all_day_ph_time.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 or 23 migrations; this release brings staging to 26.
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261022-r1',
    restore: 'docs/release-private/staging-backup-restore-20261022-r1',
    dryRun: 'docs/release-private/court-marketplace-staging-dryrun-20261022-r1',
    apply: 'docs/release-private/court-marketplace-staging-apply-20261022-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261022_r1_restore', dryRun: 'rally_staging_backup_20261022_r1_dryrun' }),
})

// Court and location photos: the public court-photos Storage bucket, public.court_photos,
// admin-only photo functions and photo fields on the public club pages. public.courts is
// not changed, so the reservation-write pause stays in force. Its backup is captured while
// Storage is still empty; once photos exist, later captures stop until photos have their
// own backup step (see run-staging-backup-capture.mjs).
export const courtPhotosRelease = Object.freeze({
  id: 'court-photos-20261023',
  title: 'Court and location photos',
  baseVersions: Object.freeze([...courtMarketplaceRelease.baseVersions,
    '20261022090000', '20261022100000', '20261022110000'].sort()),
  migrations: Object.freeze(['20261023090000_court_photos.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261023090000_court_photos.sql',
    'supabase/verification/court_photos_postflight.sql', 'supabase/verification/court_marketplace_postflight.sql',
    'supabase/verification/supabase_advisor_followup_postflight.sql', 'supabase/verification/supabase_advisor_postflight.sql',
    'supabase/verification/club_platform_postflight.sql', 'supabase/verification/two_club_isolation.sql',
    'supabase/verification/schema_fingerprint.sql', 'supabase/verification/backup_content_inventory.sql',
    'supabase/verification/reservation_write_pause_readonly.sql', 'supabase/verification/staging_privacy_readonly_preflight.sql',
    'scripts/run-staging-release-apply.mjs', 'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs',
    'scripts/restore-catalog-checks.mjs', 'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze([]) }),
    // Earlier postflights count 22, 23 or 26 migrations; this release brings staging to 27.
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261023-r1',
    restore: 'docs/release-private/staging-backup-restore-20261023-r1',
    dryRun: 'docs/release-private/court-photos-staging-dryrun-20261023-r1',
    apply: 'docs/release-private/court-photos-staging-apply-20261023-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261023_r1_restore', dryRun: 'rally_staging_backup_20261023_r1_dryrun' }),
})

// Club business profile: what a club tells players (about, contacts, links, amenities, rules and
// terms, payment methods with QR codes, add-ons, coaches, a photo gallery), admin-only profile
// functions, a public read, and Storage policies for the club picture folders in the existing
// court-photos bucket. Nothing inside the reservation-write pause changes. Staging's Storage is
// no longer empty, so its capture copies the bucket's files (see the capture's Storage step).
export const clubProfileRelease = Object.freeze({
  id: 'club-profile-20261115',
  title: 'Club business profile',
  baseVersions: Object.freeze([...courtPhotosRelease.baseVersions, '20261023090000'].sort()),
  migrations: Object.freeze(['20261115090000_club_business_profile.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261115090000_club_business_profile.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze([]) }),
    // Earlier postflights count 22, 23, 26 or 27 migrations; this release brings staging to 28.
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  // The r1 restore stopped (kept as evidence): the Storage policies were restored before the
  // application functions they call. The restore now creates them after the application schema.
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261115-r1',
    restore: 'docs/release-private/staging-backup-restore-20261115-r2',
    dryRun: 'docs/release-private/club-profile-staging-dryrun-20261115-r1',
    apply: 'docs/release-private/club-profile-staging-apply-20261115-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261115_r2_restore', dryRun: 'rally_staging_backup_20261115_r1_dryrun' }),
})

// Court owner onboarding: owners ask Rally Point for a call (request_owner_call, open to visitors,
// checked and flood-limited) and superadmins follow the requests up; owner invites by email, taken
// up at sign-in once the email is confirmed (claim_my_owner_clubs); handle_new_user gives an invited
// email no default membership. Two migrations in one release. Nothing inside the reservation-write
// pause changes, and no trigger is added to auth.users, so the capture's sign-up trigger step holds.
export const ownerOnboardingRelease = Object.freeze({
  id: 'owner-onboarding-20261116',
  title: 'Court owner onboarding',
  baseVersions: Object.freeze([...clubProfileRelease.baseVersions, '20261115090000'].sort()),
  migrations: Object.freeze(['20261116090000_owner_call_requests.sql', '20261116090100_club_owner_invites.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261116090000_owner_call_requests.sql',
    'supabase/migrations/20261116090100_club_owner_invites.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding', ignore: Object.freeze([]) }),
    // Earlier postflights count 22, 23, 26, 27 or 28 migrations; this release brings staging to 30.
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    // Opening hours are club data since the club profile screens went live: a club may set them,
    // so "every venue open 0-24" no longer holds. This release does not touch venues.
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    // r1 stopped before reaching staging: the local database container was not running.
    capture: 'docs/release-private/staging-backup-20261116-r2',
    restore: 'docs/release-private/staging-backup-restore-20261116-r1',
    dryRun: 'docs/release-private/owner-onboarding-staging-dryrun-20261116-r1',
    apply: 'docs/release-private/owner-onboarding-staging-apply-20261116-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261116_r1_restore', dryRun: 'rally_staging_backup_20261116_r1_dryrun' }),
})

// Member GCash checkout: a player holds court hours for 15 minutes (hold_court_booking), pays the
// club's own GCash QR outside Rally Point and sends the reference (submit_booking_payment); the
// club's staff or admin confirm it (booked) or reject it (released). One migration. It adds a
// member write path into bookings and court_allocations through five checked definer functions;
// the reservation-write pause on the paused tables and the nine paused booking functions stays.
// No trigger is added to auth.users, so the capture's sign-up trigger step holds.
export const memberGcashCheckoutRelease = Object.freeze({
  id: 'member-gcash-checkout-20261122',
  title: 'Member GCash checkout',
  baseVersions: Object.freeze([...ownerOnboardingRelease.baseVersions, '20261116090000', '20261116090100'].sort()),
  migrations: Object.freeze(['20261122090000_member_gcash_checkout.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261122090000_member_gcash_checkout.sql',
    'supabase/verification/member_gcash_checkout_postflight.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout', ignore: Object.freeze([]) }),
    // Earlier postflights count 22, 23, 26, 27, 28 or 30 migrations; this release brings staging to 31.
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding',
      ignore: Object.freeze(['ledger_has_owner_onboarding']) }),
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    // Clubs may set opening hours (club profile), so "every venue open 0-24" no longer holds.
    // This release does not touch venues.
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261122-r1',
    restore: 'docs/release-private/staging-backup-restore-20261122-r1',
    dryRun: 'docs/release-private/member-gcash-checkout-staging-dryrun-20261122-r1',
    apply: 'docs/release-private/member-gcash-checkout-staging-apply-20261122-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261122_r1_restore', dryRun: 'rally_staging_backup_20261122_r1_dryrun' }),
})

// Member codes and booking length (owner, 2026-11-24): new member codes start with BR- (four
// code-making functions redefined with the new prefix only), and a booking has no maximum length
// (bookings.hours allows 1 to 24; hold_court_booking takes any length of at least 1 hour that
// ends by midnight). Two migrations. No new write path: the reservation-write pause, the nine
// paused booking functions and the five checkout functions' grants are unchanged. No trigger is
// added to auth.users (handle_new_user is replaced in place), so the capture's sign-up trigger step holds.
// Rent-a-coach is not part of this release and does not depend on it.
export const memberCodesBookingLengthRelease = Object.freeze({
  id: 'member-codes-booking-length-20261124',
  title: 'Member codes and booking length',
  baseVersions: Object.freeze([...memberGcashCheckoutRelease.baseVersions, '20261122090000'].sort()),
  migrations: Object.freeze(['20261124090000_member_code_prefix.sql', '20261124100000_booking_any_length.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261124090000_member_code_prefix.sql',
    'supabase/migrations/20261124100000_booking_any_length.sql',
    'supabase/verification/member_codes_booking_length_postflight.sql',
    'supabase/verification/member_gcash_checkout_postflight.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 31 migrations; this release brings staging to 33.
    Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout',
      ignore: Object.freeze(['ledger_has_member_gcash_checkout']) }),
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding',
      ignore: Object.freeze(['ledger_has_owner_onboarding']) }),
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261124-r1',
    restore: 'docs/release-private/staging-backup-restore-20261124-r1',
    dryRun: 'docs/release-private/member-codes-booking-length-staging-dryrun-20261124-r1',
    apply: 'docs/release-private/member-codes-booking-length-staging-apply-20261124-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261124_r1_restore', dryRun: 'rally_staging_backup_20261124_r1_dryrun' }),
})

// Rent-a-coach (owner, 2026-11-24, after it was found missing from staging): coach time slots,
// lesson requests and private player/coach messages. One migration, renumbered to
// 20261124110000 (it was 20261123090000 and never applied anywhere hosted), fixed so it applies:
// a duplicate check name removed and the four new foreign keys indexed. Three new tables closed to
// API roles; fifteen definer functions for signed-in callers. No court is reserved and no payment is
// taken, so the reservation-write pause is unchanged. No trigger is added to auth.users.
export const rentACoachRelease = Object.freeze({
  id: 'rent-a-coach-20261124',
  title: 'Rent-a-coach',
  baseVersions: Object.freeze([...memberCodesBookingLengthRelease.baseVersions, '20261124090000', '20261124100000'].sort()),
  migrations: Object.freeze(['20261124110000_rent_a_coach.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261124110000_rent_a_coach.sql',
    'supabase/verification/rent_a_coach_postflight.sql',
    'supabase/verification/member_codes_booking_length_postflight.sql',
    'supabase/verification/member_gcash_checkout_postflight.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'rent_a_coach_postflight.sql', kind: 'rentACoach', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 33 migrations; this release brings staging to 34.
    Object.freeze({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength',
      ignore: Object.freeze(['ledger_has_codes_and_length']) }),
    Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout',
      ignore: Object.freeze(['ledger_has_member_gcash_checkout']) }),
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding',
      ignore: Object.freeze(['ledger_has_owner_onboarding']) }),
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261124-r2',
    restore: 'docs/release-private/staging-backup-restore-20261124-r2',
    dryRun: 'docs/release-private/rent-a-coach-staging-dryrun-20261124-r1',
    apply: 'docs/release-private/rent-a-coach-staging-apply-20261124-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261124_r2_restore', dryRun: 'rally_staging_backup_20261124_r2_dryrun' }),
})

// Member account (owner, 2026-11-24: "yes", approving the member account plan): a nickname and one
// profile photo per person (update_my_account and set_my_photo; profiles stay read-only for API
// roles), the public member-photos Storage bucket with own-folder policies, and membership requests
// that the club's staff or admins approve (plan, 30 days, amount received as a membership charge with
// no commission) or decline, with the QR pass wallet (list_my_member_passes) and three more fields in
// check_in_qr's member object. Two migrations. No booking is written, so the reservation-write pause
// is unchanged. No trigger is added to auth.users. Once the bucket exists, captures copy its files
// (knownStorageBuckets). Not approved: staging-release-approvals.mjs holds null for it.
export const memberAccountRelease = Object.freeze({
  id: 'member-account-20261125',
  title: 'Member account and membership requests',
  baseVersions: Object.freeze([...rentACoachRelease.baseVersions, '20261124110000'].sort()),
  migrations: Object.freeze(['20261125090000_member_profile.sql', '20261125090100_membership_requests.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261125090000_member_profile.sql',
    'supabase/migrations/20261125090100_membership_requests.sql',
    'supabase/verification/member_account_postflight.sql', 'supabase/verification/rent_a_coach_postflight.sql',
    'supabase/verification/member_codes_booking_length_postflight.sql',
    'supabase/verification/member_gcash_checkout_postflight.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'rent_a_coach_postflight.sql', kind: 'rentACoach' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'member_account_postflight.sql', kind: 'memberAccount', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 34 migrations; this release brings staging to 36.
    Object.freeze({ file: 'rent_a_coach_postflight.sql', kind: 'rentACoach', ignore: Object.freeze(['ledger_has_rent_a_coach']) }),
    Object.freeze({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength',
      ignore: Object.freeze(['ledger_has_codes_and_length']) }),
    Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout',
      ignore: Object.freeze(['ledger_has_member_gcash_checkout']) }),
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding',
      ignore: Object.freeze(['ledger_has_owner_onboarding']) }),
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261125-member-account-r1',
    restore: 'docs/release-private/staging-backup-restore-20261125-member-account-r1',
    dryRun: 'docs/release-private/member-account-staging-dryrun-20261125-r1',
    apply: 'docs/release-private/member-account-staging-apply-20261125-r1',
  }),
  // Own folder and database names: the dashboard analytics release (another worktree) used the plain
  // 20261125-r1 capture folder first, and captures are one-shot.
  databases: Object.freeze({ restore: 'rally_staging_backup_20261125_member_r1_restore', dryRun: 'rally_staging_backup_20261125_member_r1_dryrun' }),
})

// Staging at 36 migrations (member account applied) plus the two read-only dashboard summary
// functions, numbered after the member-account migrations.
export const dashboardAnalyticsRelease = Object.freeze({
  id: 'dashboard-analytics-20261125',
  title: 'Dashboard analytics',
  baseVersions: Object.freeze([...memberAccountRelease.baseVersions, '20261125090000', '20261125090100'].sort()),
  migrations: Object.freeze(['20261125120000_dashboard_analytics.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261125120000_dashboard_analytics.sql',
    'supabase/verification/dashboard_analytics_postflight.sql', 'supabase/verification/member_account_postflight.sql',
    'supabase/verification/rent_a_coach_postflight.sql', 'supabase/verification/member_codes_booking_length_postflight.sql',
    'supabase/verification/member_gcash_checkout_postflight.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'member_account_postflight.sql', kind: 'memberAccount' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'dashboard_analytics_postflight.sql', kind: 'dashboardAnalytics', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 36 migrations; this release brings staging to 37.
    Object.freeze({ file: 'member_account_postflight.sql', kind: 'memberAccount', ignore: Object.freeze(['ledger_has_member_account']) }),
    Object.freeze({ file: 'rent_a_coach_postflight.sql', kind: 'rentACoach', ignore: Object.freeze(['ledger_has_rent_a_coach']) }),
    Object.freeze({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength',
      ignore: Object.freeze(['ledger_has_codes_and_length']) }),
    Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout',
      ignore: Object.freeze(['ledger_has_member_gcash_checkout']) }),
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding',
      ignore: Object.freeze(['ledger_has_owner_onboarding']) }),
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    // r1 (staging-backup-20261125-r1) stopped after its dumps: the local database container was removed mid-run.
    capture: 'docs/release-private/staging-backup-20261125-r2',
    restore: 'docs/release-private/staging-backup-restore-20261125-r2',
    dryRun: 'docs/release-private/dashboard-analytics-staging-dryrun-20261125-r1',
    apply: 'docs/release-private/dashboard-analytics-staging-apply-20261125-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261125_r2_restore', dryRun: 'rally_staging_backup_20261125_r2_dryrun' }),
})

// Staging at 37 migrations (dashboard analytics applied) plus PR #25's club leaderboard and
// tournaments. The leaderboard migration was written as 20261125120000, the same version as the
// dashboard migration already on staging, so it is renumbered 20261126080000 (before tournaments,
// which redefines two of its functions). Eight closed tables and definer functions only: no booking,
// court or charge is written, so the reservation-write pause is unchanged. No Storage bucket.
// The third migration adds list_public_tournaments for the all-clubs Tournaments page (read-only,
// open to visitors). r1 of the dry run ran before it was added; the capture and restore check of
// 2026-11-26 still stand for the same 37-migration staging.
export const leaderboardTournamentsRelease = Object.freeze({
  id: 'leaderboard-tournaments-20261126',
  title: 'Club leaderboard and tournaments',
  baseVersions: Object.freeze([...dashboardAnalyticsRelease.baseVersions, '20261125120000'].sort()),
  migrations: Object.freeze(['20261126080000_club_leaderboard.sql', '20261126090000_club_tournaments.sql',
    '20261126100000_public_tournaments.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261126080000_club_leaderboard.sql',
    'supabase/migrations/20261126090000_club_tournaments.sql', 'supabase/migrations/20261126100000_public_tournaments.sql',
    'supabase/verification/leaderboard_tournaments_postflight.sql',
    'supabase/verification/dashboard_analytics_postflight.sql', 'supabase/verification/member_account_postflight.sql',
    'supabase/verification/rent_a_coach_postflight.sql', 'supabase/verification/member_codes_booking_length_postflight.sql',
    'supabase/verification/member_gcash_checkout_postflight.sql', 'supabase/verification/owner_onboarding_postflight.sql',
    'supabase/verification/club_profile_postflight.sql', 'supabase/verification/court_photos_postflight.sql',
    'supabase/verification/court_marketplace_postflight.sql', 'supabase/verification/supabase_advisor_followup_postflight.sql',
    'supabase/verification/supabase_advisor_postflight.sql', 'supabase/verification/club_platform_postflight.sql',
    'supabase/verification/two_club_isolation.sql', 'supabase/verification/schema_fingerprint.sql',
    'supabase/verification/backup_content_inventory.sql', 'supabase/verification/reservation_write_pause_readonly.sql',
    'supabase/verification/staging_privacy_readonly_preflight.sql', 'scripts/run-staging-release-apply.mjs',
    'scripts/club-platform-staging.mjs', 'scripts/club-platform-checks.mjs', 'scripts/restore-catalog-checks.mjs',
    'scripts/restore-data-checks.mjs']),
  stateCheck: Object.freeze({ file: 'dashboard_analytics_postflight.sql', kind: 'dashboardAnalytics' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'leaderboard_tournaments_postflight.sql', kind: 'leaderboardTournaments', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 37 migrations; this release brings staging to 40.
    Object.freeze({ file: 'dashboard_analytics_postflight.sql', kind: 'dashboardAnalytics',
      ignore: Object.freeze(['ledger_has_dashboard_analytics']) }),
    Object.freeze({ file: 'member_account_postflight.sql', kind: 'memberAccount', ignore: Object.freeze(['ledger_has_member_account']) }),
    Object.freeze({ file: 'rent_a_coach_postflight.sql', kind: 'rentACoach', ignore: Object.freeze(['ledger_has_rent_a_coach']) }),
    Object.freeze({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength',
      ignore: Object.freeze(['ledger_has_codes_and_length']) }),
    Object.freeze({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout',
      ignore: Object.freeze(['ledger_has_member_gcash_checkout']) }),
    Object.freeze({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding',
      ignore: Object.freeze(['ledger_has_owner_onboarding']) }),
    Object.freeze({ file: 'club_profile_postflight.sql', kind: 'clubProfile', ignore: Object.freeze(['ledger_has_club_profile']) }),
    Object.freeze({ file: 'court_photos_postflight.sql', kind: 'courtPhotos', ignore: Object.freeze(['ledger_has_court_photos']) }),
    Object.freeze({ file: 'court_marketplace_postflight.sql', kind: 'courtMarketplace',
      ignore: Object.freeze(['ledger_has_court_marketplace', 'venues_open_all_day']) }),
    Object.freeze({ file: 'supabase_advisor_followup_postflight.sql', kind: 'advisorFollowup',
      ignore: Object.freeze(['ledger_has_followup']) }),
    Object.freeze({ file: 'supabase_advisor_postflight.sql', kind: 'advisor',
      ignore: Object.freeze(['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']) }),
    Object.freeze({ file: 'club_platform_postflight.sql', kind: 'postflight', ignore: Object.freeze(['ledger_has_every_migration']) }),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261126-r1',
    restore: 'docs/release-private/staging-backup-restore-20261126-r1',
    dryRun: 'docs/release-private/leaderboard-tournaments-staging-dryrun-20261126-r2',
    apply: 'docs/release-private/leaderboard-tournaments-staging-apply-20261126-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261126_r1_restore', dryRun: 'rally_staging_backup_20261126_r2_dryrun' }),
})

// Staging at 40 migrations (leaderboard and tournaments applied) plus the fixes from that release's
// review: undo a result in any tournament (staff_void_tournament_match), at most 64 players and 300
// matches per tournament, and court checks (no court out of service, no two active matches on one
// court), with the queue draw's court picker looking across the club. Triggers and definer functions
// only; courts are read, never written, so the reservation-write pause is unchanged.
export const tournamentFixesRelease = Object.freeze({
  id: 'tournament-fixes-20261126',
  title: 'Tournament review fixes',
  baseVersions: Object.freeze([...leaderboardTournamentsRelease.baseVersions, '20261126080000', '20261126090000',
    '20261126100000'].sort()),
  migrations: Object.freeze(['20261126110000_tournament_review_fixes.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261126110000_tournament_review_fixes.sql',
    'supabase/verification/tournament_fixes_postflight.sql',
    ...leaderboardTournamentsRelease.files.filter(path => path.startsWith('supabase/verification/') || path.startsWith('scripts/'))]),
  stateCheck: Object.freeze({ file: 'leaderboard_tournaments_postflight.sql', kind: 'leaderboardTournaments' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'tournament_fixes_postflight.sql', kind: 'tournamentFixes', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 40 migrations; this release brings staging to 41.
    Object.freeze({ file: 'leaderboard_tournaments_postflight.sql', kind: 'leaderboardTournaments',
      ignore: Object.freeze(['ledger_has_leaderboard_tournaments']) }),
    ...leaderboardTournamentsRelease.postChecks.slice(1),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261126-fixes-r1',
    restore: 'docs/release-private/staging-backup-restore-20261126-fixes-r1',
    dryRun: 'docs/release-private/tournament-fixes-staging-dryrun-20261126-r1',
    apply: 'docs/release-private/tournament-fixes-staging-apply-20261126-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261126_fixes_r1_restore',
    dryRun: 'rally_staging_backup_20261126_fixes_r1_dryrun' }),
})

// Staging at 41 migrations (tournament fixes applied) plus PR #33's public coaches list
// (list_public_coaches, read-only, open to visitors; merged and published before its migration
// reached staging) and indoor/outdoor courts: courts.court_type (NULL until an admin sets it),
// admin_set_court_type, list_public_club_court_types and get_public_club_detail returning the type.
// courts gains a column and is written only by the admin definer function, so the
// reservation-write pause is unchanged.
export const coachesCourtTypesRelease = Object.freeze({
  id: 'coaches-court-types-20261126',
  title: 'Public coaches and indoor/outdoor courts',
  baseVersions: Object.freeze([...tournamentFixesRelease.baseVersions, '20261126110000'].sort()),
  migrations: Object.freeze(['20261127090000_public_coaches.sql', '20261127100000_court_types.sql']),
  // The SQL that runs and the code that runs it. Approval pins all of these bytes.
  files: Object.freeze(['supabase/migrations/20261127090000_public_coaches.sql',
    'supabase/migrations/20261127100000_court_types.sql',
    'supabase/verification/coaches_court_types_postflight.sql',
    ...tournamentFixesRelease.files.filter(path => path.startsWith('supabase/verification/') || path.startsWith('scripts/'))]),
  stateCheck: Object.freeze({ file: 'tournament_fixes_postflight.sql', kind: 'tournamentFixes' }),
  postChecks: Object.freeze([
    Object.freeze({ file: 'coaches_court_types_postflight.sql', kind: 'coachesCourtTypes', ignore: Object.freeze([]) }),
    // Earlier postflights count 22 to 41 migrations; this release brings staging to 43.
    Object.freeze({ file: 'tournament_fixes_postflight.sql', kind: 'tournamentFixes',
      ignore: Object.freeze(['ledger_has_tournament_fixes']) }),
    ...tournamentFixesRelease.postChecks.slice(1),
  ]),
  isolation: Object.freeze({ file: 'two_club_isolation.sql', plan: 55 }),
  dirs: Object.freeze({
    capture: 'docs/release-private/staging-backup-20261126-court-types-r1',
    restore: 'docs/release-private/staging-backup-restore-20261126-court-types-r1',
    dryRun: 'docs/release-private/coaches-court-types-staging-dryrun-20261126-r1',
    apply: 'docs/release-private/coaches-court-types-staging-apply-20261126-r1',
  }),
  databases: Object.freeze({ restore: 'rally_staging_backup_20261126_court_types_r1_restore',
    dryRun: 'rally_staging_backup_20261126_court_types_r1_dryrun' }),
})

export const releases = Object.freeze({ [advisorFixesRelease.id]: advisorFixesRelease,
  [advisorFollowupRelease.id]: advisorFollowupRelease, [courtMarketplaceRelease.id]: courtMarketplaceRelease,
  [courtPhotosRelease.id]: courtPhotosRelease, [clubProfileRelease.id]: clubProfileRelease,
  [ownerOnboardingRelease.id]: ownerOnboardingRelease, [memberGcashCheckoutRelease.id]: memberGcashCheckoutRelease,
  [memberCodesBookingLengthRelease.id]: memberCodesBookingLengthRelease,
  [rentACoachRelease.id]: rentACoachRelease,
  [memberAccountRelease.id]: memberAccountRelease, [dashboardAnalyticsRelease.id]: dashboardAnalyticsRelease,
  [leaderboardTournamentsRelease.id]: leaderboardTournamentsRelease,
  [tournamentFixesRelease.id]: tournamentFixesRelease,
  [coachesCourtTypesRelease.id]: coachesCourtTypesRelease })

export function getRelease(id) {
  assert.ok(Object.hasOwn(releases, id ?? ''), `Unknown release: ${id}. Known: ${Object.keys(releases).join(', ')}`)
  return releases[id]
}

/** Every release script takes exactly: --release <id> <mode>. */
export function parseReleaseArgs(argv, modes) {
  assert.ok(argv.length === 3 && argv[0] === '--release' && modes.includes(argv[2]),
    `Use --release <id> with one of ${modes.join(', ')}`)
  return { release: getRelease(argv[1]), mode: argv[2] }
}

// Check files every release uses, besides its own state, post and isolation checks.
export const releaseCheckFiles = Object.freeze(['schema_fingerprint.sql', 'backup_content_inventory.sql',
  'reservation_write_pause_readonly.sql', 'staging_privacy_readonly_preflight.sql'])

/**
 * The reviewed bytes of a release: its definition and every listed file with its
 * SHA-256. Owner approval (staging-release-approvals.mjs) pins the returned sha256.
 * Callers use the returned contents, never a second read, so what was hashed is what runs.
 */
export function releaseManifest(release, baseDir = root) {
  const migrationVersions = release.migrations.map(name => {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name)
    assert.ok(match, `Unexpected migration name: ${name}`)
    return match[1]
  })
  assert.ok(migrationVersions.every(version => version > release.baseVersions.at(-1)), 'A release migration predates the staging baseline')
  assert.deepEqual([...release.baseVersions], [...new Set(release.baseVersions)].sort(), 'Base versions must be sorted and unique')
  const checks = [...releaseCheckFiles, release.stateCheck.file, ...release.postChecks.map(check => check.file), release.isolation.file]
  const needed = [...release.migrations.map(name => `supabase/migrations/${name}`), ...checks.map(name => `supabase/verification/${name}`)]
  for (const path of needed) assert.ok(release.files.includes(path), `Release file not listed: ${path}`)
  assert.equal(new Set(release.files.map(path => path.split('/').at(-1))).size, release.files.length, 'Release file names must be unique')

  const contents = new Map(release.files.map(path => [path, readFileSync(join(baseDir, path))]))
  const isolation = contents.get(`supabase/verification/${release.isolation.file}`).toString('utf8')
  assert.ok(isolation.includes(`select extensions.plan(${release.isolation.plan});`), 'Isolation test plan changed; review required')
  assert.ok(/\nrollback;\s*$/.test(isolation), 'Isolation test must end with rollback')
  const manifest = { kind: 'staging-release-manifest-v1', definition: release,
    files: [...contents].map(([path, bytes]) => ({ path, sha256: sha(bytes) })) }
  return { manifest, sha256: sha(Buffer.from(JSON.stringify(manifest))), contents }
}

export const captureFiles = Object.freeze(['roles.sql', 'schema.sql', 'data.sql', 'managed_schema.sql',
  'managed_data.sql', 'history_schema.sql', 'history_data.sql', 'managed_before_app.sql',
  'managed_after_app.sql', 'managed_migration_data.sql', 'managed_migration_rows.json',
  'application_acl_recovery.generated.sql'])
export const snapshotNames = Object.freeze(['fingerprint', 'grants', 'inventory', 'catalog', 'sequences', 'preflight', 'privacy'])

// Storage. The logical dump holds the bucket and file records (storage.buckets and
// storage.objects); the files themselves live outside the database, so a capture copies
// them. Only these buckets may exist, with these settings; anything else stops it. A bucket
// must exist once the migration that creates it is in the migration history; before that it
// may be absent (so the capture before the member account release passes without member-photos).
export const knownStorageBuckets = Object.freeze([
  Object.freeze({ id: 'court-photos', migration: '20261023090000', public: true,
    file_size_limit: 5242880, allowed_mime_types: Object.freeze(['image/jpeg', 'image/png', 'image/webp']) }),
  Object.freeze({ id: 'member-photos', migration: '20261125090000', public: true,
    file_size_limit: 5242880, allowed_mime_types: Object.freeze(['image/jpeg', 'image/png', 'image/webp']) }),
])
export const storageBucketsSql = `select id, public, file_size_limit, allowed_mime_types
  from storage.buckets order by id;`
export const storageObjectsSql = `select bucket_id, name, (metadata->>'size')::bigint as size,
  metadata->>'mimetype' as mimetype, metadata->>'eTag' as etag
  from storage.objects order by bucket_id, name;`
export const storageCaptureFiles = Object.freeze(['storage_buckets.json', 'storage_objects.json'])
export const storageObjectFile = index => `storage-object-${String(index + 1).padStart(5, '0')}.bin`
const storageObjectFilePattern = /^storage-object-\d{5}\.bin$/

/**
 * True when every bucket staging has is a known one with the known settings, none twice, and every
 * known bucket whose migration is in `versions` (the migration history) is there.
 */
export function knownBucketsOnly(rows, versions = []) {
  const shape = bucket => ({ id: bucket?.id, public: bucket?.public === true, file_size_limit: Number(bucket?.file_size_limit),
    allowed_mime_types: [...(bucket?.allowed_mime_types ?? [])].sort() })
  if (!Array.isArray(rows) || !Array.isArray(versions)) return false
  const known = new Map(knownStorageBuckets.map(bucket => [bucket.id, shape(bucket)]))
  const ids = rows.map(row => row?.id)
  return new Set(ids).size === ids.length
    && rows.every(row => known.has(row?.id) && isDeepStrictEqual(shape(row), known.get(row.id)))
    && knownStorageBuckets.every(bucket => !versions.includes(bucket.migration) || ids.includes(bucket.id))
}

/** The public link of a stored file in a known (public) bucket; staging's unless a test names another host. */
export function publicObjectUrl(bucket, name, host = `https://${project}.supabase.co`) {
  assert.ok(knownStorageBuckets.some(known => known.id === bucket && known.public), `Not a known public bucket: ${bucket}`)
  assert.ok(typeof name === 'string' && name.length > 0 && !name.split('/').some(part => part === '' || part === '.' || part === '..'),
    'Unsafe Storage file name')
  return `${host}/storage/v1/object/public/${bucket}/${name.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Downloads one stored file through its public link (no key: the bucket is public) and checks it
 * against its record: the size, and the MD5 when the eTag holds one. Returns the bytes. Read-only.
 */
export async function downloadStoredFile(object, label, { fetchImpl = fetch, host } = {}) {
  assert.ok(knownStorageBuckets.some(bucket => bucket.id === object.bucket_id), 'A stored file is in an unknown bucket: STOP')
  const size = Number(object.size)
  assert.ok(Number.isSafeInteger(size) && size > 0, `${label} has no size in its record: STOP`)
  const response = await fetchImpl(publicObjectUrl(object.bucket_id, object.name, host),
    { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000) })
  assert.equal(response.status, 200, `${label} could not be downloaded (HTTP ${response.status}): STOP`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.length, size, `${label} downloaded with a different size: STOP`)
  const etag = String(object.etag ?? '').replaceAll('"', '')
  if (/^[a-f0-9]{32}$/.test(etag)) {
    assert.equal(createHash('md5').update(bytes).digest('hex'), etag, `${label} differs from its record: STOP`)
  }
  return { bytes, etag: etag || null }
}

/**
 * Checks a capture's Storage copies: one verified copy per stored file, in a known bucket, and
 * as many as the captured records hold. Older captures, made while Storage was empty, have none.
 */
export function verifyStorageCopies({ manifest, inventory, objects, buckets }) {
  const records = Number(inventory.find(row => row.schema_name === 'storage' && row.table_name === 'objects')?.row_count)
  assert.equal(records, manifest.storageObjects, 'The copied Storage files do not match the captured file records')
  if (buckets !== undefined) {
    assert.ok(knownBucketsOnly(buckets, manifest.versions ?? []), 'The capture holds an unknown or changed Storage bucket')
  }
  if (manifest.storageObjects === 0) return 0
  assert.ok(Array.isArray(objects) && objects.length === manifest.storageObjects, 'The Storage copy list does not match the count')
  const files = new Map(manifest.files.map(entry => [entry.file, entry]))
  const seen = new Set()
  for (const [index, copy] of objects.entries()) {
    const key = `${copy?.bucket}/${copy?.name}`
    assert.ok(knownStorageBuckets.some(known => known.id === copy?.bucket), 'A Storage copy comes from an unknown bucket')
    assert.ok(typeof copy.name === 'string' && copy.name.length > 0 && !seen.has(key), 'An unnamed or duplicate Storage copy')
    seen.add(key)
    assert.equal(copy.file, storageObjectFile(index), 'Storage copies are out of order')
    const entry = files.get(copy.file)
    assert.ok(entry && entry.sha256 === copy.sha256 && entry.bytes === copy.bytes, `A Storage copy is missing or changed: ${copy.file}`)
  }
  return objects.length
}

export const sequenceSql = `select n.nspname as schema_name, c.relname as sequence_name,
 query_to_xml(format('select last_value, is_called from %I.%I', n.nspname, c.relname), false, true, '')::text as state
 from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'S' and n.nspname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')
 order by n.nspname, c.relname;`
export const activitySql = `select (select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
   and backend_type = 'client backend' and state in ('active', 'idle in transaction')
   and usename not in ('supabase_admin', 'supabase_replication_admin', 'supabase_read_only_user')) as other_active_clients,
 (select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', relname, 'inserted', n_tup_ins,
   'updated', n_tup_upd, 'deleted', n_tup_del) order by schemaname, relname)
  from pg_stat_user_tables where schemaname in ('public', 'private', 'auth', 'storage', 'supabase_migrations')) as writes;`
export const identitySql = `select current_database() as database, current_setting('server_version') as version,
 (select array_agg(version order by version) from supabase_migrations.schema_migrations) as versions;`

export const sha = bytes => createHash('sha256').update(bytes).digest('hex')

/** The staging session pooler, read from the CLI link files. Anything else is refused. */
export function stagingTarget(baseDir = root) {
  const ref = readFileSync(join(baseDir, 'supabase/.temp/project-ref'), 'utf8').trim()
  assert.equal(ref, project, 'The linked project is not staging')
  const url = new URL(readFileSync(join(baseDir, 'supabase/.temp/pooler-url'), 'utf8').trim())
  assert.equal(url.protocol, 'postgresql:', 'Unexpected pooler URL scheme')
  assert.equal(url.password, '', 'The saved pooler URL must not contain a password')
  assert.equal(decodeURIComponent(url.username), `postgres.${project}`, 'The pooler user is not staging')
  assert.match(url.hostname, /^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$/, 'Unexpected pooler host')
  assert.equal(url.port || '5432', '5432', 'Use the session pooler on port 5432')
  assert.equal(url.pathname, '/postgres', 'Unexpected pooler database')
  return Object.freeze({ host: url.hostname, port: '5432', user: `postgres.${project}`, database: 'postgres' })
}

/** Reads the owner's password file. The value never leaves this process except as a child's PGPASSWORD. */
export function readPassword(path = passwordFile) {
  assert.ok(existsSync(path), `Password file not found: ${path}`)
  const value = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  assert.ok(value.length >= 8 && !/[\r\n]/.test(value) && !value.includes('\u0000'), 'The password file must hold one password on one line')
  return value
}

export function redact(text, secret) {
  const value = String(text ?? '')
  if (!secret) return value
  return value.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]')
}

// Only what Docker and the Supabase CLI need on Windows, plus named credentials.
const systemVariables = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'PROGRAMFILES']
export function childEnv(extra = {}, source = process.env) {
  for (const key of Object.keys(source)) {
    assert.ok(!/^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_TLS_VERIFY|PGHOST|PGPORT|PGUSER|PGDATABASE|PGSERVICE|DATABASE_URL)$/i.test(key),
      `Environment override ${key} is not allowed`)
  }
  const env = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && systemVariables.includes(key.toUpperCase())) env[key] = value
  }
  return { ...env, ...extra }
}

export function runChild(program, args, { input = '', env = childEnv(), secret = '', timeout = 600000 } = {}) {
  const result = spawnSync(program, args, { cwd: root, input, encoding: 'utf8', env, shell: false,
    windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024 })
  return { status: result.status, stdout: redact(result.stdout, secret), stderr: redact(result.stderr, secret),
    error: result.error ? redact(result.error.message, secret) : null }
}

/** psql inside the local container, pointed at the staging session pooler over TLS. */
export function stagingPsqlArgs(target, { singleTransaction = false } = {}) {
  return ['exec', '-i', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE', '-e', 'PGAPPNAME', container,
    'psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', ...(singleTransaction ? ['--single-transaction'] : []),
    '-h', target.host, '-p', target.port, '-U', target.user, '-d', target.database]
}

export function stagingPsql(target, password, sql, options = {}) {
  assert.ok(!stagingPsqlArgs(target, options).some(arg => arg.includes(password)), 'Password leaked into arguments')
  return runChild(dockerExe, stagingPsqlArgs(target, options), { input: sql, secret: password,
    env: childEnv({ PGPASSWORD: password, PGSSLMODE: 'require', PGAPPNAME: 'rally_club_platform_release' }) })
}

/** psql inside the local container against an approved local database. */
export function localPsql(database, sql, { role = 'postgres', singleTransaction = false, allowed = [] } = {}) {
  assert.ok(database === 'postgres' || allowed.includes(database), 'Unapproved local database')
  assert.ok(['postgres', 'supabase_admin'].includes(role), 'Unapproved local role')
  return runChild(dockerExe, ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1',
    ...(singleTransaction ? ['--single-transaction'] : []), '-U', role, '-d', database], { input: sql })
}

/** Turns a read-only query file into one statement that returns its rows as a JSON array. */
export function readOnlyJson(sql) {
  const body = sql.replace(/^\uFEFF/, '').replace(/^begin read only;\s*/i, '').replace(/\s*commit;\s*$/i, '')
  const start = body.search(/^(?:with |select )/im)
  assert.ok(start >= 0, 'Missing read-only SELECT query')
  const setup = body.slice(0, start)
  const query = body.slice(start).trim().replace(/;\s*$/, '')
  assert.ok(!/;\s*\S/.test(query.replace(/'[^']*'/g, "''").replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '')),
    'A read-only query file must end with a single SELECT')
  return `BEGIN READ ONLY;\n${setup}\nselect coalesce(jsonb_agg(to_jsonb(r)), '[]') from (\n${query}\n) r;\nCOMMIT;\n`
}

export function parseJsonOutput(text, label) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  assert.ok(lines.length > 0, `${label}: no output`)
  return JSON.parse(lines.at(-1))
}

/** One migration and its ledger row, for psql --single-transaction with ON_ERROR_STOP. */
export function migrationTransactionSql(name, sql) {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(name)
  assert.ok(match, `Unexpected migration name: ${name}`)
  assert.ok(!/^\s*(begin|commit|rollback|start transaction)\s*;/im.test(sql), `${name} has its own transaction control`)
  const tag = `migration_${sha(sql).slice(0, 16)}`
  assert.ok(!sql.includes(`$${tag}$`), 'Dollar-quote tag collision')
  return [
    "set local lock_timeout = '15s';",
    "set local statement_timeout = '10min';",
    'set local search_path = public, extensions;',
    sql,
    `insert into supabase_migrations.schema_migrations (version, statements, name) values ('${match[1]}', array[$${tag}$${sql}$${tag}$], '${match[2]}');`,
  ].join('\n')
}

/** Keyed comparison helper for snapshot rows. Returns the identities that differ. */
export function keyedDifferences(expected, actual, key) {
  const index = rows => {
    const map = new Map()
    for (const row of rows) {
      const id = key(row)
      assert.ok(!map.has(id), `Duplicate snapshot identity: ${id}`)
      map.set(id, JSON.stringify(row))
    }
    return map
  }
  const before = index(expected)
  const after = index(actual)
  return [...new Set([...before.keys(), ...after.keys()])].filter(id => before.get(id) !== after.get(id)).sort()
}

export const snapshotKeys = Object.freeze({
  fingerprint: row => `${row.category}\0${row.identity}`,
  inventory: row => `${row.schema_name}.${row.table_name}`,
  sequences: row => `${row.schema_name}.${row.sequence_name}`,
  preflight: row => row.check_name,
  privacy: row => row.check_name,
})

export function fingerprintMarker(rows) {
  const markers = rows.filter(row => row.category === '!fingerprint')
  assert.equal(markers.length, 1, 'Fingerprint marker missing')
  return markers[0].details
}

/** Checks a capture manifest; never reads or returns captured row values. */
export function validateCaptureManifest(manifest, versions = expectedStagingVersions) {
  assert.ok(manifest && typeof manifest === 'object', 'Missing capture manifest')
  assert.equal(manifest.result, 'CAPTURE_PASS_RESTORE_PENDING', 'Capture is not complete')
  assert.equal(manifest.project, project, 'Wrong capture project')
  assert.deepEqual(manifest.versions, [...versions], 'Capture migration history differs from the staging baseline')
  assert.match(String(manifest.publicFingerprint), /^[a-f0-9]{32}$/, 'Capture fingerprint missing')
  assert.ok(Number.isSafeInteger(manifest.storageObjects) && manifest.storageObjects >= 0, 'Capture Storage file count missing')
  assert.equal(manifest.activeClientsObserved, 0, 'An active client was observed during capture')
  assert.equal(manifest.writeCounterChanges, 0, 'Writes were observed during capture')
  assert.equal(manifest.stagingWritesAuthorized, false, 'A capture cannot authorize staging writes')
  assert.ok(Date.parse(manifest.startedAt) < Date.parse(manifest.endedAt), 'Invalid capture timestamps')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'Capture file list missing')
  const names = new Set()
  for (const entry of manifest.files) {
    assert.ok(entry && /^[a-zA-Z0-9_.-]+$/.test(entry.file ?? '') && !names.has(entry.file), 'Unsafe or duplicate capture filename')
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''),
      `Invalid capture file metadata: ${entry.file}`)
    names.add(entry.file)
  }
  for (const name of [...captureFiles, ...snapshotNames.flatMap(s => [`before_${s}.json`, `after_${s}.json`])]) {
    assert.ok(names.has(name), `Missing capture file: ${name}`)
  }
  // Stored files are only acceptable with their copies: the list, the bucket check and one copy each.
  const copies = [...names].filter(name => storageObjectFilePattern.test(name)).length
  if (manifest.storageObjects > 0) {
    for (const name of storageCaptureFiles) assert.ok(names.has(name), `Missing capture file: ${name}`)
  }
  assert.equal(copies, manifest.storageObjects, 'Stored files need their copies in the capture')
  return { files: names.size, tables: manifest.tables, versions: manifest.versions.length }
}

export function verifyCaptureFiles(manifest, readBytes, versions = expectedStagingVersions) {
  validateCaptureManifest(manifest, versions)
  for (const entry of manifest.files) {
    const bytes = readBytes(entry.file)
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === entry.bytes && sha(bytes) === entry.sha256,
      `Capture file changed: ${entry.file}`)
  }
  return manifest.files.length
}

// Storage policies are dumped with the managed Storage schema, but since the court photos release
// (20261023) they call application functions (private.can_manage_court_photo, and later
// private.can_manage_club_media and private.is_own_member_photo), which exist only once the
// application schema is restored.
// So they move after it, as the signup trigger does. pg_dump writes each on one line.
const storagePolicyStatement = /^CREATE POLICY "[^"\n]+" ON "storage"\."objects" [^\n]*;$/gm

/** Splits the Storage policies out of the managed schema, to be created after the application schema. */
export function splitStoragePolicies(managedSql) {
  const policies = managedSql.match(storagePolicyStatement) ?? []
  const before = managedSql.replace(storagePolicyStatement, '-- Storage policy restored after the application schema.')
  assert.ok(!/^CREATE POLICY [^\n]* ON "storage"\."objects"/m.test(before), 'Unrecognised Storage policy statement')
  return { before, policies }
}

/** The full restore transaction, following the reviewed 2026-09-25 restore that passed. */
export function restoreTransactionSql(read, dataFiles, catalogObjects) {
  const schema = read('schema.sql')
  const defaults = schema.match(/^ALTER DEFAULT PRIVILEGES[^;]+;/gm) ?? []
  assert.ok(defaults.length > 0, 'Missing default privileges in the schema dump')
  const managed = splitStoragePolicies(read('managed_before_app.sql'))
  return ['BEGIN;', 'CREATE SCHEMA private AUTHORIZATION postgres;', 'CREATE SCHEMA extensions AUTHORIZATION postgres;',
    'CREATE SCHEMA vault AUTHORIZATION postgres;', 'GRANT USAGE ON SCHEMA extensions TO PUBLIC;',
    'CREATE EXTENSION pgcrypto WITH SCHEMA extensions;', 'CREATE PUBLICATION supabase_realtime;',
    managed.before, read('history_schema.sql'), defaults.join('\n'), schema,
    'CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;', read('managed_after_app.sql'), ...managed.policies,
    ...dataFiles.map(read), read('application_acl_recovery.generated.sql'), defaultAclSupplement(catalogObjects), 'COMMIT;'].join('\n')
}

/** Loads and fully verifies a capture folder: hashes, unchanged snapshots and table coverage. */
export function loadCapture(directory, versions = expectedStagingVersions) {
  const read = name => readFileSync(join(directory, name), 'utf8').replace(/^﻿/, '')
  const json = name => JSON.parse(read(name))
  const manifestBytes = readFileSync(join(directory, 'capture_manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  verifyCaptureFiles(manifest, name => readFileSync(join(directory, name)), versions)
  for (const name of snapshotNames) {
    assert.ok(isDeepStrictEqual(json(`before_${name}.json`), json(`after_${name}.json`)), `Staging changed during capture: ${name}`)
  }
  assert.equal(fingerprintMarker(json('before_fingerprint.json')), manifest.publicFingerprint, 'Capture fingerprint mismatch')
  const inventory = json('before_inventory.json')
  const captured = new Set(manifest.files.map(entry => entry.file))
  verifyStorageCopies({ manifest, inventory,
    objects: captured.has('storage_objects.json') ? json('storage_objects.json') : [],
    buckets: captured.has('storage_buckets.json') ? json('storage_buckets.json') : undefined })
  const dataFiles = planRestoreData({ data: read('data.sql'), managed: read('managed_data.sql'),
    history: read('history_data.sql'), managedHistory: json('managed_migration_rows.json'), inventory })
  const catalog = json('before_catalog.json')[0].objects
  return { manifest, manifestSha256: sha(manifestBytes), read, json, inventory, dataFiles, catalog,
    restoreSql: () => restoreTransactionSql(read, dataFiles, catalog) }
}

/** Creates one new local database and restores the capture into it in a single transaction. */
export function restoreCaptureInto(capture, database) {
  assert.match(database, /^rally_[a-z0-9_]+$/, 'Unsafe local database name')
  const options = { allowed: [database] }
  const check = (result, label) => {
    assert.equal(result.status, 0, `${label} failed: ${String(result.stderr || result.error).slice(0, 2000)}`)
    return result.stdout.trim()
  }
  const image = runChild(dockerExe, ['inspect', '--format', '{{.Config.Image}}', container])
  assert.equal(check(image, 'docker inspect'), localImage, 'Wrong local Supabase PostgreSQL image')
  assert.equal(check(localPsql('postgres', "select current_database() || '|' || current_setting('server_version')"), 'identity'),
    'postgres|17.6', 'Wrong local PostgreSQL server')
  assert.equal(check(localPsql('postgres', `select count(*) from pg_database where datname = '${database}'`), 'absence'),
    '0', `Local database ${database} already exists; restores never reuse a database`)
  check(localPsql('postgres', `create database ${database} owner postgres template template0;`), 'create database')
  check(localPsql(database, capture.restoreSql(), { ...options, role: 'supabase_admin' }), 'restore transaction')
}

/** Read-only rows from a local database, as the given role. */
export function localRows(database, sql, role = 'supabase_admin') {
  const result = localPsql(database, readOnlyJson(sql), { role, allowed: [database] })
  assert.equal(result.status, 0, `Local read-only query failed: ${String(result.stderr || result.error).slice(0, 2000)}`)
  return parseJsonOutput(result.stdout, 'local query')
}

/**
 * The apply gate: the package must be the approved one, and the backup must be
 * a fresh capture of exactly the state staging is in now, restored and verified.
 */
export function verifyApplyGate({ manifestSha256, capture, captureManifestSha256, restore, dryRun, liveMarker, liveVersions,
  now = Date.now(), maxAgeHours = 12, expectedVersions = expectedStagingVersions, approvedSha = approvedManifestSha256 }) {
  assert.match(String(approvedSha), /^[a-f0-9]{64}$/, 'This release has not been approved by the owner')
  assert.equal(manifestSha256, approvedSha, 'This is not the approved release package')
  validateCaptureManifest(capture, expectedVersions)
  assert.ok(now - Date.parse(capture.endedAt) <= maxAgeHours * 3600 * 1000, `The verified backup is older than ${maxAgeHours} hours`)
  assert.equal(restore?.result, 'PASS', 'The backup has not been restored and verified')
  assert.equal(restore.captureManifestSha256, captureManifestSha256, 'The verified restore is for a different capture')
  assert.equal(dryRun?.result, 'PASS', 'The dry run on the restored copy has not passed')
  assert.equal(dryRun.captureManifestSha256, captureManifestSha256, 'The dry run used a different capture')
  assert.equal(dryRun.manifestSha256, approvedSha, 'The dry run used a different package')
  assert.deepEqual(liveVersions, [...expectedVersions], 'Staging migration history changed since the capture')
  assert.equal(liveMarker, capture.publicFingerprint, 'Staging schema changed since the capture')
  return { captureAgeMinutes: Math.round((now - Date.parse(capture.endedAt)) / 60000) }
}
