// Read-only guard for the separately named local Gate 3 Supabase project.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const repository = fileURLToPath(new URL('../', import.meta.url))
const isolated = resolve(repository, 'docs/release-private/gate3-isolated-20260925')
const source = join(repository, 'supabase')
const packageSupabase = join(isolated, 'supabase')
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function compareDirectory(relative, suffix) {
  const sourceDirectory = join(source, relative)
  const packageDirectory = join(packageSupabase, relative)
  const names = readdirSync(sourceDirectory).filter((name) => name.endsWith(suffix)).sort()
  const copied = readdirSync(packageDirectory).filter((name) => name.endsWith(suffix)).sort()
  assert.deepEqual(copied, names, `${relative} filenames differ`)
  for (const name of names) {
    assert.equal(hash(join(packageDirectory, name)), hash(join(sourceDirectory, name)),
      `${relative}/${name} differs from release source`)
  }
  return names.length
}

const migrationCount = compareDirectory('migrations', '.sql')
const testCount = compareDirectory('tests/database', '.test.sql')
assert.equal(migrationCount, 14, 'Expected the full 14-migration chain')
assert.equal(testCount, 8, 'Expected every current SQL test')
assert.equal(hash(join(packageSupabase, 'seed.sql')), hash(join(source, 'seed.sql')),
  'Copied seed differs from release source')
assert.equal(hash(join(packageSupabase, 'schema_fingerprint.sql')),
  hash(join(source, 'verification/schema_fingerprint.sql')),
  'Copied fingerprint differs from release source')

const config = readFileSync(join(packageSupabase, 'config.toml'), 'utf8')
const required = [
  /^project_id = "rally-gate3-20260925"$/m,
  /^major_version = 17$/m,
  /^port = 55321$/m,
  /^port = 55322$/m,
  /^shadow_port = 55320$/m,
  /^port = 55323$/m,
  /^port = 55324$/m,
  /^port = 55327$/m,
  /^port = 55329$/m,
  /^inspector_port = 8183$/m,
  /^sql_paths = \["\.\/seed\.sql"\]$/m,
]
for (const pattern of required) assert.match(config, pattern, `Missing isolated config ${pattern}`)
assert.ok(!config.includes('iclrvvsiwypxlwrwgqia'), 'Hosted project reference in isolated config')
assert.ok(!existsSync(join(packageSupabase, '.temp/project-ref')), 'Isolated project is linked')
for (const directory of [isolated, packageSupabase]) {
  assert.deepEqual(readdirSync(directory).filter((name) => name.startsWith('.env')), [],
    `Unexpected environment file in ${directory}`)
}

// Everything other than the local project ID and distinct ports must match
// the repo's tested Supabase config, including Auth hooks and rate limits.
const configLines = config.replace(/\r\n/g, '\n').split('\n')
for (const [isolatedLine, sourceLine] of [
  ['project_id = "rally-gate3-20260925"', 'project_id = "rally-point-web"'],
  ['port = 55321', 'port = 54321'],
  ['port = 55322', 'port = 54322'],
  ['shadow_port = 55320', 'shadow_port = 54320'],
  ['port = 55329', 'port = 54329'],
  ['port = 55323', 'port = 54323'],
  ['port = 55324', 'port = 54324'],
  ['inspector_port = 8183', 'inspector_port = 8083'],
  ['port = 55327', 'port = 54327'],
]) {
  const index = configLines.indexOf(isolatedLine)
  assert.ok(index >= 0, `Missing isolated override: ${isolatedLine}`)
  assert.equal(configLines.lastIndexOf(isolatedLine), index, `Duplicate override: ${isolatedLine}`)
  configLines[index] = sourceLine
}
assert.equal(configLines.join('\n'), readFileSync(join(source, 'config.toml'), 'utf8').replace(/\r\n/g, '\n'),
  'Isolated config differs from repo config beyond local identity and ports')

console.log(JSON.stringify({
  result: 'PASS',
  projectId: 'rally-gate3-20260925',
  migrationCount,
  testCount,
  seedSha256: hash(join(packageSupabase, 'seed.sql')),
  configSha256: hash(join(packageSupabase, 'config.toml')),
  readOnlyGuard: true,
}))
