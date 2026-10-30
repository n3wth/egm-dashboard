// Input is an already-authorized response bound by the caller to one project.
// This module does not fetch data, resolve identities or authorize access.
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export function projectEvidence({ organizationId, projectId, snapshot } = {}) {
  if (!validId(organizationId) || !validId(projectId)) throw new TypeError('organization and project required')
  if (!snapshot || snapshot.organizationId !== organizationId || snapshot.projectId !== projectId) {
    throw new TypeError('snapshot scope mismatch')
  }
  const data = snapshot.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('snapshot data required')
  const reach = data.queries?.reach?.rows?.[0]
  const traffic = data.queries?.traffic?.rows
  const rows = Array.isArray(traffic) ? traffic.slice(0, 400).flatMap(row => {
    if (typeof row?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return []
    const views = count(row.views)
    return views === null ? [] : [{ date: row.date, views }]
  }) : []
  return {
    organizationId,
    projectId,
    generatedAt: typeof snapshot.generatedAt === 'string' && Number.isFinite(Date.parse(snapshot.generatedAt)) ? snapshot.generatedAt : null,
    metrics: [
      { id: 'views', title: 'Repository views', value: count(reach?.views) },
      { id: 'clones', title: 'Clone operations', value: count(reach?.clones) },
      { id: 'cloners', title: 'Unique cloners', value: count(reach?.cloners) },
    ],
    traffic: rows,
  }
}
