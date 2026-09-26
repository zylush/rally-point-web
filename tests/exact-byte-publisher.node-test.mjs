import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { exactByteTree } from '../scripts/exact-byte-tree.mjs'

const repo = mkdtempSync(join(tmpdir(), 'rally-byte-test-'))
const git = (args, input) => {
  const result = spawnSync('git', ['-C', repo, ...args], { input, encoding: null })
  assert.equal(result.status, 0, result.stderr?.toString())
  return result.stdout
}
git(['init', '--bare'])
const frozen = readFileSync(resolve('docs/release-private/staging-privacy-release-20260923-r8/app/404.html'))

test('deployment blob preserves the frozen CRLF bytes with autocrlf enabled', () => {
  assert.ok(frozen.includes(Buffer.from('\r\n')))
  const tree = exactByteTree(repo, [{ path: '404.html', bytes: frozen }], join(repo, 'test.index'), {
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true',
  })
  assert.deepEqual(git(['cat-file', 'blob', `${tree}:404.html`]), frozen)
})

test('empty files, LF, mixed endings, binary and nested spaces survive without extra files', () => {
  const entries = [
    { path: 'empty', bytes: Buffer.alloc(0) },
    { path: 'assets/space name.bin', bytes: Buffer.from([0, 255, 13, 10, 128]) },
    { path: 'assets/mixed.txt', bytes: Buffer.from('one\r\ntwo\nthree\r\n') },
    { path: 'index.html', bytes: Buffer.from('line\n') },
  ]
  const tree = exactByteTree(repo, entries, join(repo, 'test.index'))
  assert.equal(git(['ls-tree', '-r', '--name-only', tree]).toString().trim().split('\n').length, 4)
  for (const entry of entries) assert.deepEqual(git(['cat-file', 'blob', `${tree}:${entry.path}`]), entry.bytes)
})

test('rejects empty, duplicate, unsafe paths, non-buffer input and invalid repo', () => {
  const index = join(repo, 'reject.index')
  assert.throws(() => exactByteTree(repo, [], index), /Empty/)
  assert.throws(() => exactByteTree(repo, [{ path: 'a' }, { path: 'a' }], index), /Duplicate/)
  assert.throws(() => exactByteTree(repo, [{ path: 'a', bytes: 'text' }], index), /Buffer/)
  for (const path of ['../a', '/a', '.git/config', 'a\\b', 'a\nb', 'a\tb', 'a:b', 'a//b']) {
    assert.throws(() => exactByteTree(repo, [{ path, bytes: frozen }], index), /Unsafe/)
  }
  assert.throws(() => exactByteTree(join(repo, 'missing'), [{ path: 'a', bytes: frozen }], index), /Local Git failed/)
})
