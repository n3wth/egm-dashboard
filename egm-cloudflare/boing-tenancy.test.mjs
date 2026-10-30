import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { listProjects, migrateLegacyEgm, projectAccess, readProjectPresentation, readProjectSnapshot, readProjectSources, updateProjectPresentation } from './boing-tenancy.mjs'
import { JOBS_SCHEMA } from './boing-jobs.mjs'
import { GITHUB_APP_SCHEMA } from './boing-github-app.mjs'

// Exercise the actual SQL against SQLite rather than matching mock SQL strings.
function database() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql', import.meta.url), 'utf8'))
  sql.exec(GITHUB_APP_SCHEMA)
  const db = {
    prepare(query) {
      return {
        bind(...args) { return statement(query, args) },
        ...statement(query, []),
      }
    },
    async batch(statements) {
      sql.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  function statement(query, args) {
    return {
      async first() { return sql.prepare(query).get(...args) ?? null },
      async all() { return { results: sql.prepare(query).all(...args) } },
      async run() { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } } },
    }
  }
  return { db, sql }
}

function seed(sql) {
  sql.exec(`INSERT INTO users(id,email,name,verified,status,created_at) VALUES
    ('owner','owner@example.com','Owner',1,'approved','now'),
    ('member','member@example.com','Member',1,'approved','now'),
    ('other','other@example.com','Other',1,'approved','now'),
    ('pending','pending@example.com','Pending',1,'pending','now');
    INSERT INTO snapshots VALUES(1,'{"private":"egm"}','2026-01-01');
    UPDATE presentation SET body='{"title":"legacy"}',revision=3 WHERE id=1;`)
}

test('project repository follows the active binding and never revives stale legacy data', async () => {
  const { db, sql } = database(); seed(sql)
  await migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' })
  sql.exec("UPDATE boing_projects SET repository='old/repo' WHERE id='egm-project'")
  assert.equal((await projectAccess(db, 'owner', 'egm-project', 'egm-org')).repository, 'old/repo')
  sql.exec(`INSERT INTO boing_github_installations VALUES(10,'egm-org',9,'acct','active');
    INSERT INTO boing_github_repositories VALUES('egm-org','egm-project',10,20,'new/repo');
    INSERT INTO boing_snapshot_invalidations VALUES('egm-project');`)
  assert.equal((await listProjects(db, 'owner', 'egm-org'))[0].repository, 'new/repo')
  assert.equal((await projectAccess(db, 'owner', 'egm-project', 'egm-org')).repository, 'new/repo')
  sql.exec("UPDATE boing_github_installations SET status='suspended' WHERE installation_id=10")
  assert.equal((await listProjects(db, 'owner', 'egm-org'))[0].repository, null)
  assert.equal((await projectAccess(db, 'owner', 'egm-project', 'egm-org')).repository, null)
  sql.exec("DELETE FROM boing_github_repositories WHERE project_id='egm-project'")
  assert.equal((await projectAccess(db, 'owner', 'egm-project', 'egm-org')).repository, null)
})

test('source reads expose only results for the current revision and configured active source', async () => {
  const { db, sql } = database(); seed(sql)
  await migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' })
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec(JOBS_SCHEMA)
  sql.exec(`INSERT INTO boing_github_installations VALUES(10,'egm-org',9,'acct','active');
    INSERT INTO boing_github_repositories VALUES('egm-org','egm-project',10,42,'org/repo');
    INSERT INTO boing_source_versions VALUES('egm-project','github',1),('egm-project','website',1);
    INSERT INTO boing_collection_results VALUES('egm-project','github',1,'private repo data','now'),('egm-project','website',1,'website data','now');`)
  const results = async () => Object.fromEntries((await readProjectSources(db, 'owner', 'egm-project', 'egm-org')).map(row => [row.kind, row.body]))
  assert.deepEqual(await results(), { github: 'private repo data', website: 'website data' })
  sql.exec("UPDATE boing_source_versions SET revision=2 WHERE kind='github'")
  assert.deepEqual(await results(), { github: null, website: 'website data' })
  // Returning to the same repository cannot reveal revision 1 again.
  sql.exec("UPDATE boing_source_versions SET revision=3 WHERE kind='github'")
  assert.equal((await results()).github, null)
  sql.exec("INSERT INTO boing_snapshot_invalidations VALUES('egm-project')")
  assert.equal(await readProjectSnapshot(db, 'owner', 'egm-project', 'egm-org'), null)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_snapshots WHERE project_id='egm-project'").get().n,1)
  sql.exec("UPDATE boing_collection_results SET source_revision=3 WHERE kind='github'; UPDATE boing_github_installations SET status='suspended'")
  assert.equal((await results()).github, null)
  sql.exec("UPDATE boing_projects SET website_url=NULL")
  assert.deepEqual(await results(), { github: null, website: null })
  assert.deepEqual(await readProjectSources(db, 'owner', 'egm-project', 'wrong-org'), [])
})

test('legacy migration preserves data and access, is idempotent, and does not import pending users', async () => {
  const { db, sql } = database(); seed(sql)
  const options = { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' }
  assert.deepEqual(await migrateLegacyEgm(db, options), { status: 'migrated' })
  assert.equal((await projectAccess(db, 'owner', 'egm-project', 'egm-org')).role, 'owner')
  assert.equal((await projectAccess(db, 'member', 'egm-project', 'egm-org')).role, 'member')
  assert.equal(await projectAccess(db, 'pending', 'egm-project', 'egm-org'), null)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_identities WHERE user_id='pending'").get().n, 0)
  assert.equal((await readProjectSnapshot(db, 'owner', 'egm-project', 'egm-org')).body, '{"private":"egm"}')
  assert.equal((await readProjectPresentation(db, 'owner', 'egm-project', 'egm-org')).revision, 3)
  sql.exec("UPDATE users SET status='approved' WHERE id='pending'; UPDATE snapshots SET body='new' WHERE id=1")
  assert.deepEqual(await migrateLegacyEgm(db, options), { status: 'already_migrated' })
  assert.equal(await projectAccess(db, 'pending', 'egm-project', 'egm-org'), null)
  assert.equal((await readProjectSnapshot(db, 'owner', 'egm-project', 'egm-org')).body, '{"private":"egm"}')
  assert.equal(sql.prepare('SELECT body FROM snapshots WHERE id=1').get().body, 'new')
})

test('Boing identity access does not require a legacy user and suspension revokes it', async () => {
  const { db, sql } = database(); seed(sql)
  await migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' })
  sql.exec("INSERT INTO boing_identities VALUES('boing-only','new@example.com','active'); INSERT INTO boing_memberships VALUES('egm-org','boing-only','member','active','now'); INSERT INTO boing_project_memberships VALUES('egm-org','egm-project','boing-only','now')")
  assert.equal(sql.prepare("SELECT count(*) AS n FROM users WHERE id='boing-only'").get().n, 0)
  assert.equal((await projectAccess(db, 'boing-only', 'egm-project', 'egm-org')).id, 'egm-project')
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='boing-only'")
  assert.equal(await projectAccess(db, 'boing-only', 'egm-project', 'egm-org'), null)
})

test('all project helpers require an organization scope and reject a wrong scope', async () => {
  const { db, sql } = database(); seed(sql)
  await migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' })
  sql.exec("INSERT INTO boing_organizations VALUES('other-org','Other','org_other','active',0,'now'); INSERT INTO boing_memberships VALUES('other-org','owner','owner','active','now')")
  for (const scope of [undefined, null, '', '   ']) {
    await assert.rejects(projectAccess(db, 'owner', 'egm-project', scope), /organization scope/)
    await assert.rejects(readProjectSnapshot(db, 'owner', 'egm-project', scope), /organization scope/)
    await assert.rejects(readProjectPresentation(db, 'owner', 'egm-project', scope), /organization scope/)
    await assert.rejects(updateProjectPresentation(db, 'owner', 'egm-project', '{}', 3, scope), /organization scope/)
  }
  assert.equal(await projectAccess(db, 'owner', 'egm-project', 'other-org'), null)
  assert.equal(await readProjectSnapshot(db, 'owner', 'egm-project', 'other-org'), null)
  assert.equal(await readProjectPresentation(db, 'owner', 'egm-project', 'other-org'), null)
  assert.equal(await updateProjectPresentation(db, 'owner', 'egm-project', '{}', 3, 'other-org'), false)
})

test('legacy migration aborts on a suspended or mismatched existing Boing identity', async () => {
  for (const [email, status] of [['owner@example.com', 'suspended'], ['wrong@example.com', 'active']]) {
    const { db, sql } = database(); seed(sql)
    sql.prepare('INSERT INTO boing_identities VALUES(?,?,?)').run('owner', email, status)
    await assert.rejects(() => migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' }))
    assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_organizations').get().n, 0)
  }
})

test('all tenant reads and presentation writes enforce active membership and role', async () => {
  const { db, sql } = database(); seed(sql)
  await migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' })
  sql.exec(`INSERT INTO boing_organizations VALUES('other-org','Other','org_other','active',0,'now');
    INSERT INTO boing_projects VALUES('other-project','other-org','Other',NULL,NULL,'active','now');
    INSERT INTO boing_memberships VALUES('other-org','other','owner','active','now');
    DELETE FROM boing_memberships WHERE user_id='other' AND organization_id='egm-org';
    INSERT INTO boing_snapshots VALUES('other-project','secret','now');
    INSERT INTO boing_presentations VALUES('other-project','private',0);`)
  assert.deepEqual((await listProjects(db, 'member', 'egm-org')).map(x => x.id), ['egm-project'])
  await assert.rejects(listProjects(db, 'member'), /organization scope/)
  assert.equal(await readProjectSnapshot(db, 'member', 'other-project', 'egm-org'), null)
  assert.equal(await readProjectPresentation(db, 'member', 'other-project', 'egm-org'), null)
  assert.equal(await updateProjectPresentation(db, 'member', 'other-project', '{}', 0, 'egm-org'), false)
  assert.equal(await updateProjectPresentation(db, 'member', 'egm-project', '{}', 3, 'egm-org'), false)
  assert.equal(await updateProjectPresentation(db, 'owner', 'egm-project', '{"ok":1}', 3, 'egm-org'), true)
  assert.equal(await updateProjectPresentation(db, 'owner', 'egm-project', '{}', 3, 'egm-org'), false)
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner' AND organization_id='egm-org'")
  assert.equal(await projectAccess(db, 'owner', 'egm-project', 'egm-org'), null)
  assert.equal(await updateProjectPresentation(db, 'owner', 'egm-project', '{}', 4, 'egm-org'), false)
  sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='other-org'")
  assert.equal(await readProjectSnapshot(db, 'other', 'other-project', 'other-org'), null)
})

test('migration rejects missing owner and rolls back all inserts on conflicts', async () => {
  const { db, sql } = database(); seed(sql)
  const options = { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'pending', workosOrganizationId: 'org_egm', now: 'now' }
  await assert.rejects(() => migrateLegacyEgm(db, options), /approved legacy owner/)
  sql.exec("INSERT INTO boing_organizations VALUES('other','Other','org_egm','active',0,'now')")
  await assert.rejects(() => migrateLegacyEgm(db, { ...options, ownerId: 'owner' }))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_organizations WHERE id='egm-org'").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM boing_migrations").get().n, 0)
})

test('project grants restrict members within an organization and revoke reads immediately', async () => {
  const { db, sql } = database(); seed(sql)
  await migrateLegacyEgm(db, { organizationId: 'egm-org', projectId: 'egm-project', ownerId: 'owner', workosOrganizationId: 'org_egm', now: 'now' })
  sql.exec(`INSERT INTO boing_projects VALUES('private-project','egm-org','Private',NULL,NULL,'active','now');
    INSERT INTO boing_snapshots VALUES('private-project','private','now');
    INSERT INTO boing_presentations VALUES('private-project','private',0)`)
  assert.equal((await projectAccess(db, 'owner', 'private-project', 'egm-org')).role, 'owner')
  assert.equal(await projectAccess(db, 'member', 'private-project', 'egm-org'), null)
  assert.equal(await readProjectSnapshot(db, 'member', 'private-project', 'egm-org'), null)
  assert.equal(await readProjectPresentation(db, 'member', 'private-project', 'egm-org'), null)
  assert.deepEqual((await listProjects(db, 'member', 'egm-org')).map(project => project.id), ['egm-project'])
  sql.exec("INSERT INTO boing_project_memberships VALUES('egm-org','private-project','member','now')")
  assert.equal((await readProjectSnapshot(db, 'member', 'private-project', 'egm-org')).body, 'private')
  assert.equal(await updateProjectPresentation(db, 'member', 'private-project', '{}', 0, 'egm-org'), false)
  sql.exec("DELETE FROM boing_project_memberships WHERE project_id='private-project' AND user_id='member'")
  assert.equal(await readProjectSnapshot(db, 'member', 'private-project', 'egm-org'), null)
  assert.throws(() => sql.exec("INSERT INTO boing_project_memberships VALUES('wrong-org','private-project','member','now')"), /FOREIGN KEY/)
})
