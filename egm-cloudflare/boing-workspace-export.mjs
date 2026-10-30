import { resolveBoingContext } from './boing-context.mjs'
import { authorizeProjectData, recheckProjectData } from './boing-project-data-guard.mjs'
import { handleBoingProjectExport } from './boing-export.mjs'
import { readMetricHistory } from './boing-history.mjs'

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const error = (status, code) => Response.json({ error: code }, { status, headers })
const MAX_PROJECTS = 10
const MAX_BYTES = 1024 * 1024
const sameContext = (a, b) => b?.status === 'allowed' && b.role === 'owner' &&
  a.organizationId === b.organizationId && a.userId === b.userId &&
  a.membershipId === b.membershipId && a.membershipUpdatedAt === b.membershipUpdatedAt

// A partial, bounded export, not a complete workspace backup. The organization
// selector identifies a workspace; resolveBoingContext establishes authority.
export async function handleBoingWorkspaceExport(request, env, user, organizationSelector, options = {}) {
  if (new URL(request.url).pathname !== '/api/boing/workspace/export') return null
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, allow: 'GET' } })
  const { requestWorkos = fetch, requestGithub = fetch, resolve = resolveBoingContext,
    authorize = authorizeProjectData, recheck = recheckProjectData,
    exportProject = handleBoingProjectExport, history = readMetricHistory } = options
  try {
    const context = await resolve(env, user, organizationSelector, requestWorkos)
    if (context.status !== 'allowed') return error(context.status === 'unavailable' ? 503 : 403, 'workspace_unavailable')
    if (context.role !== 'owner') return error(404, 'not_found')
    const list = async () => (await env.DB.prepare(`SELECT p.id,p.status FROM boing_projects p
      JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=?
      JOIN boing_identities u ON u.user_id=m.user_id
      WHERE o.id=? AND o.status='active' AND m.status='active' AND m.role='owner' AND u.status='active'
      ORDER BY p.id LIMIT ?`).bind(user.id, context.organizationId, MAX_PROJECTS + 1).all())?.results
    const rows = await list()
    if (!Array.isArray(rows)) return error(503, 'workspace_unavailable')
    if (rows.length > MAX_PROJECTS) return error(413, 'workspace_export_too_large')
    const projects = [], proofs = []
    let archived = 0
    for (const row of rows) {
      if (row.status === 'archived') { archived++; continue }
      if (row.status !== 'active') return error(503, 'workspace_unavailable')
      const access = await authorize(env, user, context.organizationId, row.id, 'export', { request: requestGithub })
      // Do not leak partial project data if a private repository cannot be
      // verified or if its permission has been revoked.
      if (access.status !== 'allowed') return error(access.status === 'unavailable' ? 503 : 403, 'project_export_unavailable')
      const projectRequest = new Request(new URL(`/api/boing/projects/${encodeURIComponent(row.id)}/export`, request.url))
      const exported = await exportProject(projectRequest, env, user, context.organizationId)
      if (!exported?.ok) return error(exported?.status === 413 ? 413 : 503, 'project_export_unavailable')
      const project = await exported.json()
      const records = await history(env, user, context.organizationId, row.id, { requestWorkos, requestGithub })
      if (records.status !== 'allowed') return error(records.status === 'unavailable' ? 503 : 403, 'project_export_unavailable')
      projects.push({ ...project, history: records.history })
      proofs.push(access.proof)
      if (new TextEncoder().encode(JSON.stringify(projects)).byteLength > MAX_BYTES) return error(413, 'workspace_export_too_large')
    }
    // Revalidate provider permission after all reads. A local binding check
    // alone cannot detect a repository permission revoked at GitHub.
    for (let index = 0; index < proofs.length; index++) {
      const proof = proofs[index]
      const verified = await authorize(env, user, context.organizationId, proof.projectId, 'export', { request: requestGithub })
      if (verified.status !== 'allowed' || JSON.stringify(verified.proof) !== JSON.stringify(proof) || !await recheck(env, user, proof)) {
        return error(verified.status === 'unavailable' ? 503 : 403, 'project_export_unavailable')
      }
    }
    if (JSON.stringify(await list()) !== JSON.stringify(rows) || !sameContext(context, await resolve(env, user, context.organizationId, requestWorkos))) return error(403, 'workspace_unavailable')
    const body = JSON.stringify({ version: 1, scope: 'partial_workspace_export', projects,
      omissions: { archivedProjects: archived, details: ['Archived project data', 'Disconnected or historical sources', 'Workspace membership, invitations, audit records and provider data', 'Metric history older than 90 days'] },
      consistency: 'Projects are read separately; this is not a point-in-time backup.' })
    if (new TextEncoder().encode(body).byteLength > MAX_BYTES) return error(413, 'workspace_export_too_large')
    return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="boing-workspace-export.json"' } })
  } catch { return error(503, 'workspace_unavailable') }
}
