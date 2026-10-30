import { listProjects } from './boing-tenancy.mjs'
import { verifyGithubRepository, recheckGithubBinding } from './boing-github-verify.mjs'

// The caller authenticates the session and freshly verifies the workspace
// membership. A legacy repository string is not proof of current GitHub access.
// Return no repository names unless GitHub confirms the bound installation.
export async function verifiedProjectList(env, user, organizationId, { verify = verifyGithubRepository, recheck = recheckGithubBinding, request = fetch } = {}) {
  if (!env?.DB || !user || user.status !== 'active' || user.verified !== 1 || typeof organizationId !== 'string') return { status: 'denied' }
  try {
    const rows = await listProjects(env.DB, user.id, organizationId)
    if (!Array.isArray(rows) || rows.length > 100) return { status: 'unavailable' }
    const proof = new Map()
    // Bound concurrency: one project can issue two GitHub requests.
    for (let offset = 0; offset < rows.length; offset += 5) {
      const batch = rows.slice(offset, offset + 5).filter(row => row.repository !== null && row.repository !== undefined)
      const results = await Promise.all(batch.map(row => verify(env, user, organizationId, row.id, { request })))
      for (let i = 0; i < batch.length; i++) {
        const result = results[i]
        if (!result || !['verified', 'unbound', 'denied', 'unavailable'].includes(result.status)) return { status: 'unavailable' }
        if (result.status === 'unavailable') return { status: 'unavailable' }
        if (result.status === 'verified') {
          if (!result.binding || result.binding.repositoryFullName !== batch[i].repository) return { status: 'unavailable' }
          proof.set(batch[i].id, result.binding)
        }
      }
    }
    // Do not publish a stale list after membership, project or repository
    // changes while the provider calls were in flight.
    const current = await listProjects(env.DB, user.id, organizationId)
    if (JSON.stringify(current) !== JSON.stringify(rows)) return { status: 'unavailable' }
    for (const [projectId, binding] of proof) {
      if (!await recheck(env, user, organizationId, projectId, binding)) return { status: 'unavailable' }
    }
    return { status: 'ok', projects: rows.map(row => ({ ...row, repository: proof.has(row.id) ? row.repository : null })) }
  } catch {
    return { status: 'unavailable' }
  }
}
