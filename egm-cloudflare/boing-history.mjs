import { resolveBoingContext } from './boing-context.mjs'
import { authorizeProjectData, recheckProjectData } from './boing-project-data-guard.mjs'

// Caller supplies a validated server session, never a client-supplied user.
// Return only the current source revision and recheck access before release.
export async function readMetricHistory(env, user, organizationId, projectId, { requestWorkos = fetch, requestGithub = fetch } = {}) {
  const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
  if (context.status !== 'allowed') return { status: context.status }
  const access = await authorizeProjectData(env, user, context.organizationId, projectId, 'sources', { request: requestGithub })
  if (access.status !== 'allowed') return { status: access.status }
  try {
    const read = () => env.DB.prepare(`SELECT h.kind,h.day,h.generated_at,h.metrics FROM boing_metric_history h
      JOIN boing_source_versions v ON v.project_id=h.project_id AND v.kind=h.kind AND v.revision=h.source_revision
      JOIN boing_projects p ON p.id=h.project_id AND p.organization_id=h.organization_id
      JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=?
      JOIN boing_identities u ON u.user_id=m.user_id
      WHERE h.organization_id=? AND h.project_id=? AND h.day>=date('now','-89 days') AND p.status='active' AND o.status='active'
        AND ((h.kind='website' AND p.website_url IS NOT NULL AND length(trim(p.website_url))>0)
          OR (h.kind='github' AND EXISTS (SELECT 1 FROM boing_github_repositories gr
            JOIN boing_github_installations gi ON gi.installation_id=gr.installation_id AND gi.organization_id=gr.organization_id
            WHERE gr.project_id=p.id AND gr.organization_id=o.id AND gi.status='active')))
        AND m.status='active' AND u.status='active' AND (m.role='owner' OR EXISTS
          (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))
      ORDER BY h.day DESC,h.kind LIMIT 180`).bind(user.id, context.organizationId, projectId).all()
    const rows = (await read())?.results
    if (!Array.isArray(rows) || !(await recheckProjectData(env, user, access.proof))) return { status: 'denied' }
    // Detect rebinds or concurrent updates across the asynchronous guard.
    if (JSON.stringify((await read())?.results) !== JSON.stringify(rows)) return { status: 'denied' }
    return { status: 'allowed', history: rows.map(row => ({ kind: row.kind, day: row.day, generatedAt: row.generated_at, metrics: JSON.parse(row.metrics) })) }
  } catch { return { status: 'unavailable' } }
}
