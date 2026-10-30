// An execution record survives workspace suspension and job cancellation.
// An interrupted or uncertain execution cannot be treated as quiescent merely
// because its job lease expired. No HTTP route may call these helpers.
export const EXECUTION_FENCE_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_collection_executions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open', 'settled', 'uncertain')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(job_id, claim_id)
);`

const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// Must complete before any external request associated with the claim.
// The insertion and the active-workspace check are a single D1 write.
export async function beginCollectionExecution(db, { organizationId, jobId, claimId, now = Date.now() } = {}) {
  if (!db?.prepare || !valid(organizationId) || !valid(jobId) || !valid(claimId) || !Number.isSafeInteger(now) || now < 0) return null
  const id = crypto.randomUUID()
  try {
    const result = await db.prepare(`INSERT INTO boing_collection_executions(id, organization_id, job_id, claim_id, state, started_at)
      SELECT ?,j.organization_id,j.id,j.claim_id,'open',? FROM boing_collection_jobs j
      JOIN boing_organizations o ON o.id=j.organization_id
      JOIN boing_projects p ON p.id=j.project_id AND p.organization_id=o.id
      WHERE j.id=? AND j.organization_id=? AND j.claim_id=? AND j.status='running'
        AND j.expires_at>? AND j.lease_expires_at>? AND o.status='active' AND p.status='active'`)
      .bind(id, now, jobId, organizationId, claimId, now, now).run()
    return result.meta?.changes === 1 ? id : null
  } catch { return null }
}

// Only a fully observed completion may be settled. Any interruption, abort,
// timeout or failed observation remains uncertain for operator reconciliation.
export async function finishCollectionExecution(db, { id, organizationId, claimId, observedComplete, now = Date.now() } = {}) {
  if (!db?.prepare || !valid(id) || !valid(organizationId) || !valid(claimId) || typeof observedComplete !== 'boolean' || !Number.isSafeInteger(now) || now < 0) return false
  try {
    const result = await db.prepare(`UPDATE boing_collection_executions SET state=?, finished_at=?
      WHERE id=? AND organization_id=? AND claim_id=? AND state='open'`)
      .bind(observedComplete ? 'settled' : 'uncertain', now, id, organizationId, claimId).run()
    return result.meta?.changes === 1
  } catch { return false }
}

// This checks only tracked collector executions. It cannot prove that WorkOS,
// GitHub callbacks, other provider calls or external processors are quiescent.
export async function hasUnsettledCollectionExecutions(db, organizationId) {
  if (!db?.prepare || !valid(organizationId)) return null
  try {
    const row = await db.prepare(`SELECT EXISTS(SELECT 1 FROM boing_collection_executions
      WHERE organization_id=? AND state IN ('open','uncertain')) AS unsettled`).bind(organizationId).first()
    return row?.unsettled === 1 ? true : row?.unsettled === 0 ? false : null
  } catch { return null }
}
