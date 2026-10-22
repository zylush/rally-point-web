// Pure rules for the club platform release package and its rehearsal.
// No filesystem, CLI, network or database access.
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'

// What hosted staging recorded on 2026-09-26 and re-checked read-only on 2026-10-17:
// the September chain without tenant enforcement, with the reservation-write pause.
export const stagingMigrations = Object.freeze([
  '001_rally_point.sql', '002_bookings.sql', '003_open_play_qr.sql', '004_member_signup.sql',
  '20260803125450_authorization_boundary.sql', '20260805094557_auth_rate_limits.sql',
  '20260921090000_tenant_ready.sql', '20260921110828_tenant_backfill.sql',
  '20260922011918_tenant_table_grant_repair.sql', '20260922163027_booking_rpc_alias_repair.sql',
  '20260922163830_booking_cancellation_command.sql', '20260922164128_rls_member_lookup_repair.sql',
  '20260923053440_member_privacy_repair.sql', '20260925174111_reservation_write_pause.sql',
])

// Applied to staging one at a time, in this order. The support-inquiry pair is
// included because support sessions read public.support_inquiries.
export const packageMigrations = Object.freeze([
  '20260921111105_tenant_enforcement.sql',
  '20260927105500_support_inquiries.sql',
  '20260928170000_support_inquiry_replies.sql',
  '20261017090000_club_context.sql',
  '20261017090100_platform_control.sql',
  '20261017090200_club_membership.sql',
  '20261017090300_support_sessions.sql',
])

export const sqlSuites = Object.freeze([
  'auth_rate_limits.test.sql', 'authorization_boundary.test.sql', 'club_context.test.sql',
  'club_membership.test.sql', 'commission_ledger.test.sql', 'null_role_guards.test.sql',
  'platform_control.test.sql', 'same_club_privacy.test.sql', 'staff_assignment_reads.test.sql',
  'staff_roster_coexistence.test.sql', 'support_inquiries.test.sql', 'support_sessions.test.sql',
  'tenant_boundary.test.sql', 'tenant_table_grants.test.sql',
])

export const preflightChecks = Object.freeze([
  'ledger_is_staging_baseline', 'tenant_enforcement_not_applied', 'reservation_writes_paused',
  'support_inquiries_not_applied', 'club_platform_not_applied', 'default_club_active',
  'auth_users_readable', 'no_leftover_isolation_fixture', 'auth_users_insertable',
  'pgtap_available', 'club_count',
])

export const postflightChecks = Object.freeze([
  'ledger_has_every_migration', 'tenant_enforcement_applied', 'reservation_writes_still_paused',
  'platform_tables_have_row_security', 'platform_tables_closed_to_client_writes',
  'private_platform_tables_unreadable', 'club_terms_signed_in_read_only',
  'platform_functions_signed_in_only', 'private_platform_helpers_hidden', 'public_club_lookup_open',
  'club_context_open_to_boards', 'every_club_has_an_account', 'commission_triggers_enabled',
  'support_inquiries_present', 'default_club_active', 'platform_superadmins', 'club_count',
])

export const advisorChecks = Object.freeze([
  'ledger_has_advisor_fix', 'foreign_keys_indexed', 'btree_gist_outside_public', 'policies_read_caller_once',
  'venues_single_select_policy', 'row_security_tables_have_policies', 'only_schedule_board_is_definer_view',
  'view_functions_signed_in_only', 'reservation_writes_still_paused', 'platform_tables_closed',
])

export const advisorFollowupChecks = Object.freeze([
  'ledger_has_followup', 'foreign_keys_indexed_in_order', 'no_definer_views', 'schedule_board_reads_board_function',
  'schedule_board_open_to_boards', 'board_schema_holds_only_the_schedule', 'view_readers_can_run_view_functions',
  'private_schema_closed_to_anon', 'reservation_writes_still_paused', 'platform_tables_closed',
])

export const courtMarketplaceChecks = Object.freeze([
  'ledger_has_court_marketplace', 'reservation_writes_still_paused', 'court_and_join_functions_signed_in_only',
  'club_directory_open_to_visitors', 'new_functions_pin_search_path', 'court_member_rate', 'player_membership_pair',
  'venue_locations', 'venues_open_all_day', 'philippine_time_only', 'listed_clubs',
])

export const isolationCheckCount = 55

const same = (actual, expected, message) => assert.ok(isDeepStrictEqual(actual, expected), message)

/** The two replay orders: staging's ledger then the package, and plain timestamp order. */
export function clubPlatformOrders(names) {
  assert.ok(Array.isArray(names), 'Migration inventory missing')
  same([...names].sort(), [...stagingMigrations, ...packageMigrations].sort(), 'Unreviewed or missing migration')
  return {
    stage: [...stagingMigrations, ...packageMigrations],
    clean: [...names].sort(),
  }
}

export function verifySuiteInventory(names) {
  assert.ok(Array.isArray(names), 'SQL suite inventory missing')
  same([...names].sort(), [...sqlSuites], 'SQL suite inventory changed; review required')
}

/**
 * Checks preflight, postflight or advisor rows: the names must match exactly and
 * every required row must pass, except names listed in `ignore` (a later release
 * that legitimately changes them). Information rows are returned, never judged.
 */
export function evaluateChecks(rows, kind, { ignore = [] } = {}) {
  const kinds = { preflight: preflightChecks, postflight: postflightChecks, advisor: advisorChecks,
    advisorFollowup: advisorFollowupChecks, courtMarketplace: courtMarketplaceChecks }
  const expected = Object.hasOwn(kinds, kind) ? kinds[kind] : null
  assert.ok(expected, 'Unknown check kind')
  assert.ok(ignore.every(name => expected.includes(name)), `${kind}: unknown check in ignore list`)
  assert.ok(Array.isArray(rows), `${kind}: rows missing`)
  same(rows.map(row => row.check_name), [...expected], `${kind}: check list changed; review required`)
  for (const row of rows) {
    assert.equal(typeof row.required, 'boolean', `${kind}: ${row.check_name} has no required flag`)
    assert.equal(typeof row.ok, 'boolean', `${kind}: ${row.check_name} has no result`)
  }
  const failed = rows.filter(row => row.required && !row.ok && !ignore.includes(row.check_name)).map(row => row.check_name)
  assert.deepEqual(failed, [], `${kind} failed: ${failed.join(', ')}`)
  return {
    kind,
    passed: rows.filter(row => row.required && !ignore.includes(row.check_name)).length,
    ignored: [...ignore],
    information: Object.fromEntries(rows.filter(row => !row.required)
      .map(row => [row.check_name, { ok: row.ok, detail: row.detail }])),
  }
}

/**
 * Reads pgTAP output from psql. psql also prints the values of set_config()
 * calls, so non-TAP lines are ignored, but any failure, skip or bail-out fails.
 */
export function parseTapOutput(text, name, expectedPlan) {
  assert.equal(typeof text, 'string', `${name}: TAP output missing`)
  const lines = text.split(/\r?\n/).map(line => line.trimEnd())
  const bad = lines.find(line => /^not ok\b/.test(line) || /^Bail out!/.test(line) || /^# Looks like/.test(line)
    || (/^ok \d+/.test(line) && /#\s*(?:SKIP|TODO)\b/i.test(line)))
  assert.equal(bad, undefined, `${name}: ${bad}`)
  const plans = lines.filter(line => /^1\.\.\d+$/.test(line))
  assert.equal(plans.length, 1, `${name}: missing or duplicate TAP plan`)
  const planned = Number(plans[0].slice(3))
  assert.ok(planned > 0, `${name}: empty TAP plan`)
  if (expectedPlan !== undefined) assert.equal(planned, expectedPlan, `${name}: TAP plan changed`)
  const numbers = lines.filter(line => /^ok \d+(?:\s|$)/.test(line)).map(line => Number(line.match(/^ok (\d+)/)[1]))
  same(numbers, Array.from({ length: planned }, (_, index) => index + 1), `${name}: incomplete or out-of-order TAP`)
  return { name, planned, passed: numbers.length }
}

/** What an approved staging run must do. Planning data only; nothing here can execute. */
export function clubPlatformRunPlan() {
  return {
    kind: 'club-platform-staging-plan-v1',
    stagingExecutable: false,
    transportIncluded: false,
    target: { name: 'Rally-Point-Database', ref: 'iclrvvsiwypxlwrwgqia' },
    requiresBeforeAnyWrite: [
      'owner approval of this manifest SHA-256 and a run window',
      'a fresh, verified backup of the target',
      'confirmed target ref and no other connected clients',
      'club_platform_preflight.sql with every required row ok',
    ],
    steps: [
      'run checks/club_platform_preflight.sql read-only; stop unless every required row is ok',
      'capture checks/schema_fingerprint.sql, restore_catalog_snapshot.sql and tenant_grant_snapshot.sql',
      'apply each package migration alone, in packageOrder, with its supabase_migrations ledger row',
      'stop at the first error; no retry without review',
      'run checks/club_platform_postflight.sql read-only; stop unless every required row is ok',
      'run checks/reservation_write_pause_readonly.sql; all 66 rows must show violation = false',
      'capture the fingerprint again and compare it with the rehearsed post-package fingerprint',
      'run checks/two_club_isolation.sql in its single rolled-back transaction (needs auth.users INSERT for the migration role)',
      'record the evidence; production stays at one club',
    ],
    packageOrder: [...packageMigrations],
    rollback: 'No down migrations exist. A failed step stops the run; recovery is a reviewed forward fix or a restore from the fresh backup.',
    notIncluded: ['reservation RPC resume', 'payment provider', 'production', 'app publication'],
    knownEffects: [
      'invalidates the frozen reservation-rpc-resume-20260926-r1 package, which pins the 15-migration inventory',
      'new clubs can be set up but cannot take reservations while the pause holds',
    ],
  }
}
