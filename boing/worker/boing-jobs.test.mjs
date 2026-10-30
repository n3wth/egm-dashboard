import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { JOBS_SCHEMA, enqueueCollectionJob, claimCollectionJob, finishCollectionJob, publishCollectionSnapshot } from './boing-jobs.mjs'
import { BOING_IDENTITY_SCHEMA } from './boing-identity.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES
    ('owner','owner@example.com','active'),('member','member@example.com','active');
    INSERT INTO boing_organizations VALUES('org1','One','workos1','active',0,'now'),('org2','Two','workos2','active',0,'now');
    INSERT INTO boing_projects VALUES('p1','org1','One','one/repo','https://one.test','active','now'),('p2','org2','Two','two/repo','https://two.test','active','now');
    INSERT INTO boing_memberships VALUES('org1','owner','owner','active','now'),('org1','member','member','active','now'),('org2','owner','owner','active','now');
    INSERT INTO boing_source_versions VALUES('p1','github',1),('p1','website',1),('p2','github',1),('p2','website',1);
    INSERT INTO boing_github_installations VALUES(1,'org1',1,'one','active'),(2,'org2',2,'two','active');
    INSERT INTO boing_github_repositories VALUES('org1','p1',1,11,'one/repo'),('org2','p2',2,22,'two/repo');`)
  let batches = Promise.resolve()
  const db = {
    prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
    } } } },
    batch(statements) {
      const task = batches.then(async () => {
        sql.exec('BEGIN')
        try {
          const result = []
          for (const statement of statements) result.push(await statement.run())
          sql.exec('COMMIT')
          return result
        } catch (error) { sql.exec('ROLLBACK'); throw error }
      })
      batches = task.catch(() => {})
      return task
    },
  }
  return { sql, db }
}
const owner = { id: 'owner', verified: 1 }
const member = { id: 'member', verified: 1 }

test('a changed membership version cannot publish collected data', async () => {
  const { sql, db } = fixture()
  sql.exec(readFileSync(new URL('./boing-membership-binding-migration.sql', import.meta.url), 'utf8'))
  sql.exec("INSERT INTO boing_workos_membership_bindings VALUES('org1','owner','om_123','2026-01-01T00:00:00Z')")
  const id = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website')
  const claim = await claimCollectionJob(db, id)
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='2026-01-02T00:00:00Z'")
  const published = await publishCollectionSnapshot(db, { organizationId: 'org1', projectId: 'p1', jobId: id, claimId: claim.claimId,
    snapshot: '{"status":"available","performanceScore":90}', membershipBinding: { id: 'om_123', updatedAt: '2026-01-01T00:00:00Z', role: 'owner' } })
  assert.equal(published, false)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_collection_results').get().n, 0)
  assert.equal(sql.prepare('SELECT count(*) n FROM boing_metric_history').get().n, 0)
})

test('enqueue requires a verified organization scope and project access', async () => {
  const { db, sql } = fixture()
  assert.equal(await enqueueCollectionJob(db, owner, 'org1', 'p2', 'github'), null)
  assert.equal(await enqueueCollectionJob(db, member, 'org1', 'p1', 'github'), null)
  assert.equal(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'token'), null)
  const id = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github')
  assert.ok(id)
  const stored = sql.prepare('SELECT * FROM boing_collection_jobs WHERE id=?').get(id)
  assert.deepEqual(Object.keys(stored), ['id', 'organization_id', 'project_id', 'actor_id', 'kind', 'source_revision', 'status', 'claim_id', 'created_at', 'expires_at', 'lease_expires_at', 'finished_at'])
  assert.equal(stored.organization_id, 'org1')
  assert.equal(stored.project_id, 'p1')
})

test('only one live job of each type and one concurrent claimant', async () => {
  const { db } = fixture()
  const ids = await Promise.all(Array.from({ length: 8 }, () => enqueueCollectionJob(db, owner, 'org1', 'p1', 'github')))
  assert.equal(ids.filter(Boolean).length, 1)
  const id = ids.find(Boolean)
  const claims = await Promise.all(Array.from({ length: 8 }, () => claimCollectionJob(db, id)))
  assert.equal(claims.filter(Boolean).length, 1)
  const claim = claims.find(Boolean)
  assert.equal(await finishCollectionJob(db, id, 'invalid', true), false)
  assert.equal(await finishCollectionJob(db, id, claim.claimId, true), true)
  assert.equal(await finishCollectionJob(db, id, claim.claimId, true), false)
  assert.ok(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github'))
})

test('revoked grants and archived projects deny claim and completion', async () => {
  const { db, sql } = fixture()
  sql.exec("INSERT INTO boing_project_memberships VALUES('org1','p1','member','now')")
  const first = await enqueueCollectionJob(db, member, 'org1', 'p1', 'github')
  sql.exec("DELETE FROM boing_project_memberships WHERE user_id='member'")
  assert.equal(await claimCollectionJob(db, first), null)
  const second = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website')
  const claim = await claimCollectionJob(db, second)
  sql.exec("UPDATE boing_projects SET status='archived' WHERE id='p1'")
  assert.equal(await finishCollectionJob(db, second, claim.claimId, true), false)
  assert.equal(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github'), null)
})

test('suspended independent identity cannot enqueue or claim', async () => {
  const { db, sql } = fixture()
  const id = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github')
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner'")
  assert.equal(await claimCollectionJob(db, id), null)
  assert.equal(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website'), null)
})

test('revoked queued and running work is cancelled to unblock another authorized actor', async () => {
  const { db, sql } = fixture()
  sql.exec("INSERT INTO boing_project_memberships VALUES('org1','p1','member','now')")
  const t = 1_800_000_000_000
  const queued = await enqueueCollectionJob(db, member, 'org1', 'p1', 'github', t)
  const running = await enqueueCollectionJob(db, member, 'org1', 'p1', 'website', t)
  const claim = await claimCollectionJob(db, running, t + 1)
  sql.exec("DELETE FROM boing_project_memberships WHERE user_id='member'")
  const replacement = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', t + 2)
  assert.ok(replacement)
  assert.equal(await claimCollectionJob(db, queued, t + 3), null)
  assert.equal(await finishCollectionJob(db, running, claim.claimId, true, t + 3), false)
  assert.deepEqual(sql.prepare('SELECT status FROM boing_collection_jobs WHERE id IN (?,?) ORDER BY kind').all(queued, running).map(row => row.status), ['cancelled', 'cancelled'])
})

test('expired queue and lease permit replacements and reject stale claim tokens', async () => {
  const { db } = fixture()
  const t = 1_800_000_000_000
  const queued = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', t)
  assert.equal(await claimCollectionJob(db, queued, t + 15 * 60_000), null)
  assert.ok(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', t + 15 * 60_000))
  const running = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website', t)
  const claim = await claimCollectionJob(db, running, t + 1)
  const expiry = t + 1 + 5 * 60_000
  assert.equal(await finishCollectionJob(db, running, claim.claimId, true, expiry), false)
  assert.ok(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website', expiry))
  assert.equal(await finishCollectionJob(db, running, claim.claimId, true, expiry + 1), false)
})

test('publication consumes the claim once and cannot cross tenant or project', async () => {
  const { db, sql } = fixture()
  const now = 1_800_000_000_000
  const jobId = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', now)
  const { claimId } = await claimCollectionJob(db, jobId, now + 1)
  const args = { organizationId: 'org1', projectId: 'p1', jobId, claimId, snapshot: '{"stars":42}', now: now + 2 }
  assert.equal(await publishCollectionSnapshot(db, { ...args, organizationId: 'org2', projectId: 'p2' }), false)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_collection_results').get().n, 0)
  const results = await Promise.all(Array.from({ length: 8 }, () => publishCollectionSnapshot(db, args)))
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(sql.prepare('SELECT body FROM boing_collection_results WHERE project_id=? AND kind=?').get('p1', 'github').body, '{"stars":42}')
  assert.equal(await publishCollectionSnapshot(db, { ...args, snapshot: '{"stars":0}' }), false)
  assert.equal(sql.prepare('SELECT body FROM boing_collection_results WHERE project_id=? AND kind=?').get('p1', 'github').body, '{"stars":42}')
})

test('publication rejects revoked, expired, invalid and oversized inputs', async () => {
  const { db, sql } = fixture()
  sql.exec("INSERT INTO boing_project_memberships VALUES('org1','p1','member','now')")
  const now = 1_800_000_000_000
  const jobId = await enqueueCollectionJob(db, member, 'org1', 'p1', 'github', now)
  const { claimId } = await claimCollectionJob(db, jobId, now + 1)
  const args = { organizationId: 'org1', projectId: 'p1', jobId, claimId, snapshot: '{}', now: now + 2 }
  assert.equal(await publishCollectionSnapshot(db, { ...args, snapshot: '[]' }), false)
  assert.equal(await publishCollectionSnapshot(db, { ...args, snapshot: '{' }), false)
  assert.equal(await publishCollectionSnapshot(db, { ...args, snapshot: JSON.stringify({ text: 'a'.repeat(262_144) }) }), false)
  assert.equal(await publishCollectionSnapshot(db, { ...args, now: now + 5 * 60_000 + 1 }), false)
  sql.exec("DELETE FROM boing_project_memberships WHERE user_id='member'")
  assert.equal(await publishCollectionSnapshot(db, args), false)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_collection_results').get().n, 0)
})

test('publication rolls back job completion if snapshot write fails', async () => {
  const { db, sql } = fixture()
  const now = 1_800_000_000_000
  const jobId = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', now)
  const { claimId } = await claimCollectionJob(db, jobId, now + 1)
  sql.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON boing_collection_results BEGIN SELECT RAISE(ABORT,'write failure'); END")
  const args = { organizationId: 'org1', projectId: 'p1', jobId, claimId, snapshot: '{}', now: now + 2 }
  await assert.rejects(publishCollectionSnapshot(db, args), /write failure/)
  assert.equal(sql.prepare('SELECT status FROM boing_collection_jobs WHERE id=?').get(jobId).status, 'running')
  sql.exec('DROP TRIGGER fail_snapshot')
  assert.equal(await publishCollectionSnapshot(db, args), true)
})

test('source publication preserves other source results and migrated EGM snapshot in either order', async () => {
  for (const order of [['github', 'website'], ['website', 'github']]) {
    const { db, sql } = fixture()
    sql.exec(`INSERT INTO boing_snapshots VALUES('p1','{"legacy":"egm"}','old')`)
    const now = 1_800_000_000_000
    for (const kind of order) {
      const jobId = await enqueueCollectionJob(db, owner, 'org1', 'p1', kind, now)
      const { claimId } = await claimCollectionJob(db, jobId, now + 1)
      assert.equal(await publishCollectionSnapshot(db, { organizationId: 'org1', projectId: 'p1', jobId, claimId, snapshot: JSON.stringify({ source: kind }), now: now + 2 }), true)
    }
    const sources = sql.prepare('SELECT kind,body FROM boing_collection_results WHERE project_id=? ORDER BY kind').all('p1')
    assert.deepEqual(sources.map(row => ({ ...row })), [
      { kind: 'github', body: '{"source":"github"}' },
      { kind: 'website', body: '{"source":"website"}' },
    ])
    assert.equal(sql.prepare('SELECT body FROM boing_snapshots WHERE project_id=?').get('p1').body, '{"legacy":"egm"}')
  }
})

test('source reconfiguration and installation revocation invalidate in-flight jobs', async () => {
  const { db, sql } = fixture()
  const now = 1_800_000_000_000
  const web = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website', now)
  const webClaim = await claimCollectionJob(db, web, now + 1)
  // The configuration change and version update must be in one transaction.
  sql.exec("BEGIN; UPDATE boing_projects SET website_url='https://changed.test' WHERE id='p1'; UPDATE boing_source_versions SET revision=revision+1 WHERE project_id='p1' AND kind='website'; COMMIT")
  const base = { organizationId: 'org1', projectId: 'p1', jobId: web, claimId: webClaim.claimId, snapshot: '{"status":"available"}', now: now + 2 }
  assert.equal(await publishCollectionSnapshot(db, base), false)
  const github = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', now)
  const githubClaim = await claimCollectionJob(db, github, now + 1)
  sql.exec("UPDATE boing_github_installations SET status='suspended' WHERE installation_id=1")
  assert.equal(await publishCollectionSnapshot(db, { ...base, jobId: github, claimId: githubClaim.claimId }), false)
  assert.equal(await enqueueCollectionJob(db, owner, 'org1', 'p1', 'github', now + 3), null)
})

test('a change away and back does not revive stale results and unavailable does not replace success', async () => {
  const { db, sql } = fixture()
  const now = 1_800_000_000_000
  const jobId = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website', now)
  const { claimId } = await claimCollectionJob(db, jobId, now + 1)
  const args = { organizationId: 'org1', projectId: 'p1', jobId, claimId, snapshot: '{"status":"available","score":99}', now: now + 2 }
  assert.equal(await publishCollectionSnapshot(db, args), true)
  const second = await enqueueCollectionJob(db, owner, 'org1', 'p1', 'website', now + 3)
  const secondClaim = await claimCollectionJob(db, second, now + 4)
  assert.equal(await publishCollectionSnapshot(db, { ...args, jobId: second, claimId: secondClaim.claimId, snapshot: '{"status":"unavailable"}', now: now + 5 }), false)
  assert.equal(await finishCollectionJob(db, second, secondClaim.claimId, false, now + 6), true)
  assert.equal(sql.prepare("SELECT body FROM boing_collection_results WHERE project_id='p1' AND kind='website'").get().body, args.snapshot)
  sql.exec("BEGIN; UPDATE boing_projects SET website_url='https://other.test' WHERE id='p1'; UPDATE boing_source_versions SET revision=revision+1 WHERE project_id='p1' AND kind='website'; UPDATE boing_projects SET website_url='https://one.test' WHERE id='p1'; UPDATE boing_source_versions SET revision=revision+1 WHERE project_id='p1' AND kind='website'; COMMIT")
  assert.equal(sql.prepare(`SELECT count(*) n FROM boing_collection_results r JOIN boing_source_versions v
    ON v.project_id=r.project_id AND v.kind=r.kind AND v.revision=r.source_revision WHERE r.project_id='p1' AND r.kind='website'`).get().n, 0)
})
