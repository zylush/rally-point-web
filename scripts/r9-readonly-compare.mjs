import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'

const project = 'iclrvvsiwypxlwrwgqia'
const commit = '558f2fee0be9ae876960e4913928535cd38242ad'

export function assertExactSnapshot(label, reference, current) {
  assert.ok(isDeepStrictEqual(reference, current), `${label} drift`)
}

export function verifyCanonicalFingerprint(reference, current, expectedMarker, expectedRows) {
  assert.ok(Array.isArray(reference) && Array.isArray(current), 'Canonical fingerprint rows missing')
  assert.equal(reference.length, expectedRows, 'Saved canonical fingerprint row count drift')
  assert.equal(current.length, expectedRows, 'Current canonical fingerprint row count drift')
  assert.match(expectedMarker, /^[0-9a-f]{32}$/, 'Pinned fingerprint marker invalid')
  for (const [label, rows] of [['Saved', reference], ['Current', current]]) {
    const markers = rows.filter((row) => row.category === '!fingerprint' && row.identity === 'md5')
    assert.equal(markers.length, 1, `${label} canonical fingerprint marker count drift`)
    assert.equal(markers[0].details, expectedMarker, `${label} canonical fingerprint marker drift`)
  }
  assertExactSnapshot('Canonical fingerprint', reference, current)
  return { rows: current.length, marker: expectedMarker }
}

export function assertStableActivity(reference, start, end) {
  for (const sample of [start, end]) {
    assert.equal(Number(sample.other_active_clients), 0, 'Other staging clients detected')
    assert.ok(Array.isArray(sample.writes), 'Write counters missing')
    assertExactSnapshot('Operational write counters', reference.writes, sample.writes)
  }
  assertExactSnapshot('In-check write counters', start.writes, end.writes)
}

export function verifyStagingTarget(response) {
  assert.ok(response && typeof response === 'object' && !Array.isArray(response),
    'Projects response envelope missing')
  assert.ok(isDeepStrictEqual(Object.keys(response).sort(), ['message', 'projects']),
    'Projects response envelope changed')
  assert.ok(response.message === '', 'Projects response contains a message')
  assert.ok(Array.isArray(response.projects), 'Projects list missing')
  const matches = response.projects.filter((item) => item.id === project)
  assert.equal(matches.length, 1, 'Staging project not uniquely identified')
  const target = matches[0]
  assert.ok(target.name === 'Rally-Point-Database', 'Staging project name drift')
  assert.ok(target.status === 'ACTIVE_HEALTHY', 'Staging project status drift')
  assert.ok(target.linked === true, 'Staging project link drift')
  assert.ok(target.region === 'ap-northeast-1', 'Staging project region drift')
}

export function verifyPagesMetadata(pages, branch, build) {
  assert.equal(pages.html_url, 'https://zylush.github.io/rally-point-web/', 'Pages target drift')
  assert.equal(pages.source?.branch, 'gh-pages', 'Pages branch drift')
  assert.equal(pages.source?.path, '/', 'Pages path drift')
  assert.equal(pages.build_type, 'legacy', 'Pages build type drift')
  assert.equal(branch.object?.sha, commit, 'Pages deployment commit drift')
  assert.equal(build.commit, commit, 'Pages build commit drift')
  assert.equal(build.status, 'built', 'Pages build not complete')
}

export function verifyPublicProjectionResponse(status, rows, contentType) {
  assert.equal(status, 200, 'Public projection or publishable-key acceptance failed')
  assert.ok(contentType?.toLowerCase().startsWith('application/json'), 'Public projection content type invalid')
  assert.ok(Array.isArray(rows) && rows.length === 0, 'Limit-zero public projection returned data')
}
