// Build and verify a deployment tree without checkout/add filters or Git config changes.
// Does not create commits, update refs, or push. Callers own approval/deadline guards.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

export function exactByteTree(repo, entries, indexPath, extraEnv = {}) {
  assert.ok(entries.length > 0, 'Empty deployment forbidden')
  assert.equal(new Set(entries.map(e => e.path)).size, entries.length, 'Duplicate path')
  for (const entry of entries) {
    assert.ok(Buffer.isBuffer(entry.bytes), 'Raw Buffer required')
    assert.ok(!['\\', '\0', '\r', '\n', '\t', ':'].some(char => entry.path.includes(char)) && !entry.path.startsWith('/') &&
      entry.path.split('/').every(p => p && p !== '.' && p !== '..' && p.toLowerCase() !== '.git'), 'Unsafe deployment path')
  }
  const git = (args, input) => {
    const result = spawnSync('git', ['-C', repo, ...args], {
      input, encoding: null, timeout: 30000, maxBuffer: 30 * 1024 * 1024,
      env: { ...process.env, ...extraEnv, GIT_INDEX_FILE: indexPath },
    })
    assert.equal(result.status, 0, `Local Git failed: ${args[0]}: ${result.stderr?.toString()}`)
    return result.stdout
  }
  git(['read-tree', '--empty'])
  for (const entry of entries) {
    const blob = git(['hash-object', '-w', '--no-filters', '--stdin'], entry.bytes).toString().trim()
    assert.deepEqual(git(['cat-file', 'blob', blob]), entry.bytes, `Blob mismatch: ${entry.path}`)
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${entry.path}`])
  }
  const tree = git(['write-tree']).toString().trim()
  const paths = git(['ls-tree', '-rz', '--name-only', tree]).toString().split('\0').filter(Boolean).sort()
  assert.deepEqual(paths, entries.map(e => e.path).sort(), 'Unexpected deployment file inventory')
  for (const entry of entries) {
    assert.deepEqual(git(['cat-file', 'blob', `${tree}:${entry.path}`]), entry.bytes, `Tree mismatch: ${entry.path}`)
  }
  return tree
}
