// Validate captured CLI output only. This module never runs the CLI or SQL.
const pause = '20260925174111_reservation_write_pause.sql'

export function verifyReservationPauseDryRun(stdout, stderr, exitCode) {
  if (exitCode !== 0) throw new Error('CLI dry run did not exit successfully')
  if (typeof stdout !== 'string' || typeof stderr !== 'string' ||
      stdout.length > 32768 || stderr.length > 32768) {
    throw new Error('CLI dry-run output has an invalid shape')
  }
  let result
  try { result = JSON.parse(stdout) } catch {
    throw new Error('CLI dry-run stdout must be one JSON object')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      result.dryRun !== true || result.upToDate !== false ||
      !Array.isArray(result.migrations) || result.migrations.length !== 1 ||
      result.migrations[0] !== pause ||
      !Array.isArray(result.seeds) || result.seeds.length !== 0 ||
      !Array.isArray(result.roles) || result.roles.length !== 0 ||
      result.message !== 'Finished supabase db push.') {
    throw new Error('CLI dry run is not the single approved pause migration')
  }
  if (!stderr.includes('DRY RUN: migrations will *not* be pushed to the database.') ||
      !stderr.includes('Would push these migrations:')) {
    throw new Error('CLI human output does not confirm a dry run')
  }
  const ansiStyle = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
  const plainStderr = stderr.replace(ansiStyle, '')
  const namedMigrations = plainStderr.match(/\b\d{14}_[a-z0-9_]+\.sql\b/g) ?? []
  if (namedMigrations.length !== 1 || namedMigrations[0] !== pause) {
    throw new Error('CLI human output does not list only the approved pause')
  }
  return { result: 'PASS', dryRun: true, pending: [pause] }
}
