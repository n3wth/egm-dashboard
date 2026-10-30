import { publicWebsiteUrl } from './boing-integrations.mjs'

// userId and verifiedOrganizationId come from an authenticated server session
// and freshly verified WorkOS context. Project IDs only select a resource.
// D1 batch must execute these statements in a single transaction.
export async function updateProjectWebsite(db, { userId, verifiedOrganizationId, projectId, website, membershipBinding = null }) {
  if (!db?.prepare || !db?.batch || ![userId, verifiedOrganizationId, projectId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256)) throw new TypeError('Verified context required')
  const url = website === null ? null : publicWebsiteUrl(website)
  if (membershipBinding !== null && (!/^om_[A-Za-z0-9]+$/.test(membershipBinding?.id ?? '') || typeof membershipBinding?.updatedAt !== 'string')) throw new TypeError('Invalid membership binding')
  const versionSql = membershipBinding ? ` AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b
    WHERE b.organization_id=boing_projects.organization_id AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''
  const result = await db.batch([
    db.prepare(`UPDATE boing_projects SET website_url=? WHERE id=? AND organization_id=? AND status='active'
      AND EXISTS (SELECT 1 FROM boing_memberships m
        JOIN boing_organizations o ON o.id=m.organization_id
        JOIN boing_identities u ON u.user_id=m.user_id
        WHERE m.organization_id=boing_projects.organization_id AND m.user_id=?
          AND m.role='owner' AND m.status='active' AND o.status='active' AND u.status='active')${versionSql}`)
      .bind(...[url, projectId, verifiedOrganizationId, userId, ...(membershipBinding ? [userId, membershipBinding.id, membershipBinding.updatedAt] : [])]),
    db.prepare(`INSERT INTO boing_source_versions(project_id,kind,revision)
      SELECT ?,'website',1 WHERE changes()=1
      ON CONFLICT(project_id,kind) DO UPDATE SET revision=revision+1`).bind(projectId),
    db.prepare(`INSERT INTO boing_snapshot_invalidations(project_id)
      SELECT ? WHERE changes()=1 ON CONFLICT(project_id) DO NOTHING`).bind(projectId),
  ])
  return result[0].meta?.changes === 1
}
