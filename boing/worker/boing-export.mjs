// Staging-only project export. The caller must establish the user from a
// verified session and pass the local organization ID whose WorkOS membership
// was just verified on the server. Never derive that argument from the request.
// This exports only the project records named below;
// it is not yet a complete workspace data portability implementation.
import { visibleProjectRepository } from './boing-tenancy.mjs'

const MAX_BYTES = 1024 * 1024
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const error = (status, code) => Response.json({ error: code }, { status, headers })

export async function handleBoingProjectExport(request, env, user, organizationId) {
  const match = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/export$/.exec(new URL(request.url).pathname)
  if (!match) return null
  if (!user || typeof user.id !== 'string' || !user.id || user.status !== 'active' || user.verified !== 1) return error(401, 'sign_in_required')
  if (typeof organizationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId)) return error(403, 'verified_organization_required')
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, allow: 'GET' } })
  if (!env?.DB?.prepare) return error(503, 'service_unavailable')
  try {
    // Access and all exported records are selected in one query, so a revoked
    // grant cannot authorize a later independent fetch of the project data.
    const row = await env.DB.prepare(`SELECT p.id,p.name,${visibleProjectRepository} AS repository,p.website_url,s.generated_at,
      CASE WHEN length(CAST(s.body AS BLOB))<=? THEN s.body END AS snapshot,
      CASE WHEN length(CAST(v.body AS BLOB))<=? THEN v.body END AS presentation,
      v.revision,
      CASE WHEN length(CAST(g.body AS BLOB))<=? THEN g.body END AS github_body,
      g.generated_at AS github_at,
      CASE WHEN length(CAST(w.body AS BLOB))<=? THEN w.body END AS website_body,
      w.generated_at AS website_at,
      CASE WHEN s.body IS NOT NULL AND length(CAST(s.body AS BLOB))>? THEN 1
           WHEN v.body IS NOT NULL AND length(CAST(v.body AS BLOB))>? THEN 1
           WHEN g.body IS NOT NULL AND length(CAST(g.body AS BLOB))>? THEN 1
           WHEN w.body IS NOT NULL AND length(CAST(w.body AS BLOB))>? THEN 1 ELSE 0 END AS too_large
      FROM boing_projects p JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_memberships m ON m.organization_id=o.id JOIN boing_identities u ON u.user_id=m.user_id
      LEFT JOIN boing_snapshots s ON s.project_id=p.id
        AND NOT EXISTS (SELECT 1 FROM boing_snapshot_invalidations si WHERE si.project_id=p.id)
      LEFT JOIN boing_presentations v ON v.project_id=p.id
      LEFT JOIN boing_source_versions gv ON gv.project_id=p.id AND gv.kind='github'
        AND EXISTS (SELECT 1 FROM boing_github_repositories gr JOIN boing_github_installations gi
          ON gi.installation_id=gr.installation_id AND gi.organization_id=gr.organization_id
          WHERE gr.project_id=p.id AND gr.organization_id=o.id AND gi.status='active')
      LEFT JOIN boing_collection_results g ON g.project_id=p.id AND g.kind='github' AND g.source_revision=gv.revision
      LEFT JOIN boing_source_versions wv ON wv.project_id=p.id AND wv.kind='website'
        AND p.website_url IS NOT NULL AND length(trim(p.website_url))>0
      LEFT JOIN boing_collection_results w ON w.project_id=p.id AND w.kind='website' AND w.source_revision=wv.revision
      WHERE p.id=? AND o.id=? AND m.user_id=? AND m.status='active' AND o.status='active'
        AND p.status='active' AND u.status='active'
        AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
          WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))`)
      .bind(MAX_BYTES, MAX_BYTES, MAX_BYTES, MAX_BYTES, MAX_BYTES, MAX_BYTES, MAX_BYTES, MAX_BYTES, match[1], organizationId, user.id).first()
    if (!row) return error(404, 'not_found')
    if (row.too_large) return error(413, 'export_too_large')
    const source = (body, generatedAt) => {
      if (body === null) return null
      const data = JSON.parse(body)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid source')
      return data.status === 'unavailable' ? null : { data, generatedAt }
    }
    const body = JSON.stringify({
      version: 1,
      project: { id: row.id, name: row.name, repository: row.repository, websiteUrl: row.website_url },
      snapshot: row.snapshot === null ? null : { data: JSON.parse(row.snapshot), generatedAt: row.generated_at },
      presentation: row.presentation === null ? null : { data: JSON.parse(row.presentation), revision: row.revision },
      sources: { github: source(row.github_body, row.github_at), website: source(row.website_body, row.website_at) },
    })
    if (new TextEncoder().encode(body).byteLength > MAX_BYTES) return error(413, 'export_too_large')
    return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="boing-project-export.json"' } })
  } catch {
    return error(503, 'service_unavailable')
  }
}
