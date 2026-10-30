import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectEvidence } from './model.mjs'

const snapshot = { organizationId: 'org-a', projectId: 'project-a', generatedAt: '2026-10-28T00:00:00Z', data: {
  queries: { reach: { rows: [{ views: 0, clones: 12 }] }, traffic: { rows: [{ date: '2026-10-27', views: 9 }, { date: 'bad', views: 100 }, { date: '2026-10-28', views: -1 }] } },
} }

test('keeps zero distinct from unavailable and uses only reviewed rows', () => {
  const result = projectEvidence({ organizationId: 'org-a', projectId: 'project-a', snapshot })
  assert.deepEqual(result.metrics.map(metric => metric.value), [0, 12, null])
  assert.deepEqual(result.traffic, [{ date: '2026-10-27', views: 9 }])
})

test('rejects mismatched and absent project scopes without defaults', () => {
  assert.throws(() => projectEvidence({ organizationId: 'org-b', projectId: 'project-a', snapshot }), /scope mismatch/)
  assert.throws(() => projectEvidence({ organizationId: 'org-a', projectId: 'project-b', snapshot }), /scope mismatch/)
  assert.throws(() => projectEvidence({ projectId: 'project-a', snapshot }), /required/)
})
