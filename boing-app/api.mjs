export class ApiError extends Error {
  constructor(status) { super('request_failed'); this.status = status }
}

const githubId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

export async function collectProject(projectId, { organizationId, request = fetch, signal } = {}) {
  if (!githubId(projectId) || !githubId(organizationId)) throw new TypeError('invalid selector')
  const response = await request(`/api/boing/projects/${encodeURIComponent(projectId)}/collect`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'x-boing-organization': organizationId },
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  if (result?.status !== 'queued') throw new Error('invalid_response')
}

export async function startGithubInstall(projectId, { organizationId, request = fetch, signal } = {}) {
  if (!githubId(projectId) || !githubId(organizationId)) throw new TypeError('invalid selector')
  const response = await request('/api/boing/github/install', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
    body: JSON.stringify({ projectId }),
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  let url
  try { url = new URL(result.url) } catch { throw new Error('invalid_response') }
  if (url.origin !== 'https://github.com' || !/^\/apps\/[A-Za-z0-9-]+\/installations\/new$/.test(url.pathname) || url.username || url.password) throw new Error('invalid_response')
  return url.href
}

export async function listGithubRepositories(projectId, { organizationId, request = fetch, signal } = {}) {
  if (!githubId(projectId) || !githubId(organizationId)) throw new TypeError('invalid selector')
  const data = await readJson('/api/boing/github/repositories', { organizationId, request, signal })
  if (data?.projectId !== projectId || !Array.isArray(data.repositories)) throw new Error('invalid_response')
  return data.repositories.filter(item => Number.isSafeInteger(item?.id) && item.id > 0 && typeof item.fullName === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(item.fullName) && typeof item.private === 'boolean')
}

export async function selectGithubRepository(repositoryId, { organizationId, request = fetch, signal } = {}) {
  if (!githubId(organizationId) || !Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new TypeError('invalid selector')
  const response = await request('/api/boing/github/select', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
    body: JSON.stringify({ repositoryId }),
  })
  if (!response.ok) throw new ApiError(response.status)
  if ((await response.json())?.connected !== true) throw new Error('invalid_response')
}

export async function createProject(name, { request = fetch, signal, organizationId } = {}) {
  if (typeof organizationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId) || typeof name !== 'string') throw new TypeError('invalid project')
  const response = await request('/api/boing/projects', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result?.project?.id ?? '') || typeof result.project.name !== 'string') throw new Error('invalid_response')
  return result.project
}

export async function renameProject(projectId, name, { request = fetch, signal, organizationId } = {}) {
  if (![projectId, organizationId].every(githubId) || typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new TypeError('invalid project')
  const response = await request(`/api/boing/projects/${encodeURIComponent(projectId)}/name`, {
    method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
    body: JSON.stringify({ name: name.trim() }),
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  if (result?.project?.id !== projectId || result.project.name !== name.trim()) throw new Error('invalid_response')
  return result.project
}

export async function readJson(path, { request = fetch, signal, organizationId } = {}) {
  const headers = { accept: 'application/json' }
  if (organizationId !== undefined) {
    if (typeof organizationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId)) throw new TypeError('invalid organization selector')
    headers['x-boing-organization'] = organizationId
  }
  const response = await request(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers })
  if (!response.ok) throw new ApiError(response.status)
  return response.json()
}

export async function updateWebsite(projectId, website, { request = fetch, signal, organizationId } = {}) {
  if (![projectId, organizationId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new TypeError('invalid selector')
  if (website !== null && typeof website !== 'string') throw new TypeError('invalid website')
  const response = await request(`/api/boing/projects/${encodeURIComponent(projectId)}/website`, {
    method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
    body: JSON.stringify({ website }),
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  if (result?.updated !== true) throw new Error('invalid_response')
}

export async function updatePresentation(projectId, presentation, revision, { request = fetch, signal, organizationId } = {}) {
  if (![projectId, organizationId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new TypeError('invalid selector')
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation) || !Number.isSafeInteger(revision) || revision < 0) throw new TypeError('invalid presentation')
  const response = await request(`/api/boing/projects/${encodeURIComponent(projectId)}/presentation`, {
    method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
    body: JSON.stringify({ presentation, revision }),
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  if (!result?.presentation || typeof result.presentation !== 'object' || Array.isArray(result.presentation) || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error('invalid_response')
  return result
}

export async function acceptInvitation(token, { request = fetch, signal } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(token)) throw new TypeError('invalid invitation')
  const response = await request('/api/boing/invitations/accept', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) throw new ApiError(response.status)
  const result = await response.json()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result?.organizationId ?? '')) throw new Error('invalid_response')
  return result.organizationId
}

export function metricsFromSnapshot(snapshot) {
  const isCollectorSnapshot = snapshot?.metrics != null || snapshot?.traffic != null
  const reach = isCollectorSnapshot ? {
    stars: snapshot.metrics?.stars,
    forks: snapshot.metrics?.forks,
    openIssues: snapshot.metrics?.openIssues,
    views: snapshot.traffic?.views?.status === 'available' ? snapshot.traffic.views.count : null,
    clones: snapshot.traffic?.clones?.status === 'available' ? snapshot.traffic.clones.count : null,
  } : snapshot?.queries?.reach?.rows?.[0]
  if (!reach || typeof reach !== 'object') return []
  return [['stars', 'GitHub stars'], ['forks', 'GitHub forks'], ['views', 'Repository views (reporting window)'],
    ...(isCollectorSnapshot ? [['clones', 'Repository clones (reporting window)'], ['openIssues', 'Open issues and pull requests']] : [])]
    .filter(([key]) => typeof reach[key] === 'number' && Number.isFinite(reach[key]) && reach[key] >= 0)
    .map(([key, label]) => ({ label, value: reach[key] }))
}

// Report the age of the stored snapshot without assuming a collection cadence.
export function snapshotFreshness(timestamp, now = Date.now()) {
  if (typeof timestamp !== 'string' || !timestamp.trim() || !Number.isFinite(now)) return 'Collection time unavailable'
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time) || time > now) return 'Collection time unavailable'
  const hours = Math.floor((now - time) / 3600000)
  const age = hours < 1 ? 'less than an hour ago' : hours === 1 ? '1 hour ago' : `${hours} hours ago`
  return `Collected ${age} · ${new Date(time).toLocaleString()}`
}

export function metricCards(snapshot) {
  const known = new Map(metricsFromSnapshot(snapshot).map(metric => [metric.label, metric.value]))
  return ['GitHub stars', 'GitHub forks', 'Repository views (reporting window)', 'Repository clones (reporting window)', 'Open issues and pull requests'].map(label => ({
    label,
    value: known.has(label) ? known.get(label) : null,
  }))
}

export function sourceStatus(source, label) {
  if (!source) return `${label}: no source record available.`
  const freshness = source.available ? snapshotFreshness(source.generatedAt) : 'No collected data available'
  const latest = source.lastCollection?.status
  const outcome = latest === 'failed' || source.error === 'collection_failed' ? 'Latest collection failed.' : latest === 'running' || latest === 'queued' ? 'Collection in progress.' : ''
  const unavailable = source.error === 'source_unavailable' || source.data?.status === 'unavailable' ? ' Measurement unavailable.' : ''
  const configuration = source.collectionConfigured === false ? ' Collection is not configured.' : ''
  return `${label}: ${freshness}.${unavailable}${outcome ? ` ${outcome}` : ''}${configuration}`
}

export function websiteMetric(source) {
  const score = source?.available && source.data?.status === 'available' ? source.data.performanceScore : null
  return { label: 'Website performance (mobile)', value: typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null }
}
