import { createRepositoryToken } from './boing-integrations.mjs'

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const githubHeaders = { accept: 'application/vnd.github+json', 'user-agent': 'boing-growth', 'x-github-api-version': '2022-11-28' }

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > 262144 || !response.body) throw new Error('invalid response')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 262144) throw new Error('response too large')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { try { await reader.cancel() } catch {} }
}

// The caller authenticates the session and freshly verifies WorkOS membership.
// Project and organization IDs select data; this query rechecks local access.
async function readBinding(db, userId, organizationId, projectId) {
  return db.prepare(`SELECT o.workos_organization_id, r.installation_id, r.repository_id, r.repository_full_name,
      i.status AS installation_status, v.revision
    FROM boing_projects p JOIN boing_organizations o ON o.id=p.organization_id
    JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=?
    JOIN boing_identities u ON u.user_id=m.user_id
    LEFT JOIN boing_github_repositories r ON r.organization_id=o.id AND r.project_id=p.id
    LEFT JOIN boing_github_installations i ON i.installation_id=r.installation_id AND i.organization_id=o.id
    LEFT JOIN boing_source_versions v ON v.project_id=p.id AND v.kind='github'
    WHERE o.id=? AND p.id=? AND o.status='active' AND p.status='active'
      AND m.status='active' AND u.status='active'
      AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
        WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))`)
    .bind(userId, organizationId, projectId).first()
}

const sameBinding = (a, b) => !!a && !!b && a.installation_id === b.installation_id &&
  a.repository_id === b.repository_id && a.repository_full_name === b.repository_full_name &&
  a.workos_organization_id === b.workos_organization_id &&
  a.revision === b.revision && a.installation_status === 'active' && b.installation_status === 'active'

// Test transports may be injected only by trusted callers. No token or provider
// response is returned. Unbound projects require a separate legacy-data policy.
export async function verifyGithubRepository(env, user, organizationId, projectId, { request = fetch } = {}) {
  if (!env?.DB?.prepare || !user || user.status !== 'active' || user.verified !== 1 ||
      !validId(user.id) || !validId(organizationId) || !validId(projectId)) return { status: 'denied' }
  try {
    const before = await readBinding(env.DB, user.id, organizationId, projectId)
    if (!before) return { status: 'denied' }
    if (before.repository_id == null) return { status: 'unbound' }
    if (before.installation_status !== 'active' || !Number.isSafeInteger(before.installation_id) || before.installation_id < 1 ||
        !Number.isSafeInteger(before.repository_id) || before.repository_id < 1 || !Number.isSafeInteger(before.revision) || before.revision < 1 ||
        typeof before.repository_full_name !== 'string') return { status: 'denied' }
    if (!Number.isSafeInteger(Number(env.GITHUB_APP_ID)) || Number(env.GITHUB_APP_ID) < 1 ||
        typeof env.GITHUB_APP_PRIVATE_KEY !== 'string' || !env.GITHUB_APP_PRIVATE_KEY) return { status: 'unavailable' }
    const { token } = await createRepositoryToken({ installationId: before.installation_id, repositoryId: before.repository_id,
      appId: Number(env.GITHUB_APP_ID), privateKey: env.GITHUB_APP_PRIVATE_KEY }, request)
    const response = await request('https://api.github.com/installation/repositories?per_page=100&page=1', {
      headers: { ...githubHeaders, authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return { status: 'unavailable' }
    const data = await boundedJson(response)
    if (!Array.isArray(data?.repositories) || data.repositories.length !== 1 || data.total_count !== 1 ||
        data.repositories[0]?.id !== before.repository_id || data.repositories[0]?.full_name !== before.repository_full_name) return { status: 'denied' }
    const after = await readBinding(env.DB, user.id, organizationId, projectId)
    if (!sameBinding(before, after)) return { status: 'denied' }
    return { status: 'verified', binding: { workosOrganizationId: before.workos_organization_id, installationId: before.installation_id, repositoryId: before.repository_id,
      repositoryFullName: before.repository_full_name, revision: before.revision } }
  } catch { return { status: 'unavailable' } }
}

// Invoke immediately before disclosing any previously read data. This only
// checks local changes since provider verification, not another network call.
export async function recheckGithubBinding(env, user, organizationId, projectId, binding) {
  if (!env?.DB?.prepare || !user || user.status !== 'active' || user.verified !== 1 ||
      !validId(user.id) || !validId(organizationId) || !validId(projectId) || !binding) return false
  try {
    const current = await readBinding(env.DB, user.id, organizationId, projectId)
    return sameBinding({ workos_organization_id: binding.workosOrganizationId, installation_id: binding.installationId, repository_id: binding.repositoryId,
      repository_full_name: binding.repositoryFullName, revision: binding.revision, installation_status: 'active' }, current)
  } catch { return false }
}
