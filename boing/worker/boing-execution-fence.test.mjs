import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { EXECUTION_FENCE_SCHEMA, beginCollectionExecution, finishCollectionExecution, hasUnsettledCollectionExecutions } from './boing-execution-fence.mjs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(JOBS_SCHEMA)
  sql.exec(EXECUTION_FENCE_SCHEMA)
  sql.exec(`INSERT INTO boing_identities VALUES('user_Owner','owner@example.com','active');
    INSERT INTO boing_organizations VALUES('a','A','org_A','active',0,'now'),('b','B','org_B','active',0,'now');
    INSERT INTO boing_memberships VALUES('a','user_Owner','owner','active','now'),('b','user_Owner','owner','active','now');
    INSERT INTO boing_projects VALUES('p','a','P',NULL,'https://example.com','active','now'),('q','b','Q',NULL,'https://example.com','active','now');
    INSERT INTO boing_collection_jobs(id,organization_id,project_id,actor_id,kind,source_revision,status,claim_id,created_at,expires_at,lease_expires_at)
    VALUES('job-a','a','p','user_Owner','website',1,'running','claim-a','now',10000,10000),
    ('job-b','b','q','user_Owner','website',1,'running','claim-b','now',10000,10000);`)
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } } },
  } } } } }
  return { sql, db }
}

test('an open execution survives suspension and remains tenant-scoped', async () => {
  const { sql, db } = fixture()
  const id = await beginCollectionExecution(db, { organizationId: 'a', jobId: 'job-a', claimId: 'claim-a', now: 100 })
  assert.ok(id)
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='a'; UPDATE boing_collection_jobs SET status='cancelled',claim_id=NULL,lease_expires_at=NULL WHERE id='job-a'")
  assert.equal(await hasUnsettledCollectionExecutions(db, 'a'), true)
  assert.equal(await hasUnsettledCollectionExecutions(db, 'b'), false)
  assert.equal(await beginCollectionExecution(db, { organizationId: 'a', jobId: 'job-a', claimId: 'claim-a', now: 101 }), null)
  assert.equal(await finishCollectionExecution(db, { id, organizationId: 'b', claimId: 'claim-a', observedComplete: true, now: 102 }), false)
  assert.equal(await finishCollectionExecution(db, { id, organizationId: 'a', claimId: 'claim-a', observedComplete: true, now: 102 }), true)
  assert.equal(await hasUnsettledCollectionExecutions(db, 'a'), false)
})

test('ambiguous outcomes and missing storage fail closed', async () => {
  const { db } = fixture()
  const id = await beginCollectionExecution(db, { organizationId: 'a', jobId: 'job-a', claimId: 'claim-a', now: 100 })
  assert.equal(await finishCollectionExecution(db, { id, organizationId: 'a', claimId: 'claim-a', observedComplete: false, now: 101 }), true)
  assert.equal(await hasUnsettledCollectionExecutions(db, 'a'), true)
  assert.equal(await finishCollectionExecution(db, { id, organizationId: 'a', claimId: 'claim-a', observedComplete: true, now: 102 }), false)
  assert.equal(await hasUnsettledCollectionExecutions({ prepare() { throw new Error('down') } }, 'a'), null)
  assert.equal(await beginCollectionExecution(db, { organizationId: 'b', jobId: 'job-a', claimId: 'claim-a', now: 100 }), null)
  assert.equal(await beginCollectionExecution(db, { organizationId: 'b', jobId: 'job-b', claimId: 'claim-b', now: 10000 }), null)
})
