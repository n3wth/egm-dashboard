import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {GITHUB_APP_SCHEMA,issueInstallationState,completeInstallation,bindRepository,listAvailableRepositories,setInstallationStatus,verifyGitHubWebhook} from './boing-github-app.mjs'
import {BOING_IDENTITY_SCHEMA} from './boing-identity.mjs'

// Real schemas only; there is no legacy users table in this fixture.
function database() {
  const sql=new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(BOING_IDENTITY_SCHEMA)
  sql.exec(readFileSync(new URL('./boing-tenancy-schema.sql',import.meta.url),'utf8'))
  sql.exec(`INSERT INTO boing_identities(user_id,email,status) VALUES('owner-a','a@example.com','active'),('owner-b','b@example.com','active'),('admin','admin@example.com','active'),('member','member@example.com','active'),('suspended','s@example.com','suspended');
    INSERT INTO boing_organizations VALUES('org-a','A','wa','active',0,'now'),('org-b','B','wb','active',0,'now');
    INSERT INTO boing_memberships VALUES('org-a','owner-a','owner','active','now'),('org-b','owner-b','owner','active','now'),('org-a','admin','admin','active','now'),('org-a','member','member','active','now'),('org-a','suspended','owner','active','now');
    INSERT INTO boing_projects VALUES('project-a','org-a','A',NULL,NULL,'active','now'),('project-b','org-b','B',NULL,NULL,'active','now');`)
  sql.exec(GITHUB_APP_SCHEMA)
  sql.exec("CREATE TABLE boing_source_versions(project_id TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(project_id,kind))")
  return {sql,db:{prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}}}}},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}}}
}

function github({installationId=10,appId=55,repositories=[{id:42,full_name:'org/repo'}],suspendedAt=null}={}) {
  return async(url,options)=>{
    assert.equal(new URL(url).origin,'https://api.github.com')
    assert.equal(options.redirect,'manual')
    assert.equal(options.headers.authorization,'Bearer server-side-oauth')
    if(new URL(url).pathname==='/user/installations') return Response.json({installations:[{id:installationId,app_id:appId,suspended_at:suspendedAt,account:{id:9,login:'octo'}}]})
    if(new URL(url).pathname===`/user/installations/${installationId}/repositories`) return Response.json({repositories})
    throw new Error('Unexpected GitHub endpoint')
  }
}

const oauth='server-side-oauth'
test('workspace suspension fences installation admission and provider callbacks', async () => {
  const { db, sql } = database(), now = 1000
  const prepare = db.prepare.bind(db)
  db.prepare = query => {
    if (query.startsWith('INSERT INTO boing_github_install_states')) {
      sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='org-a'")
    }
    return prepare(query)
  }
  await assert.rejects(issueInstallationState(db, { organizationId: 'org-a', userId: 'owner-a', now }), /unavailable/)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_install_states').get().n, 0)
  db.prepare = prepare
  sql.exec("UPDATE boing_organizations SET status='active' WHERE id='org-a'")
  const respond = github(), state = await issueInstallationState(db, { organizationId: 'org-a', userId: 'owner-a', now })
  await assert.rejects(completeInstallation(db, { state, userId: 'owner-a', installationId: 10, appId: 55, userAccessToken: oauth, now: now + 1 }, async (...args) => {
    const response = await respond(...args)
    sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='org-a'")
    return response
  }), /revoked/)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_installations').get().n, 0)
  sql.exec("UPDATE boing_organizations SET status='active' WHERE id='org-a'")
  const next = await issueInstallationState(db, { organizationId: 'org-a', userId: 'owner-a', now })
  await completeInstallation(db, { state: next, userId: 'owner-a', installationId: 10, appId: 55, userAccessToken: oauth, now: now + 1 }, respond)
  await assert.rejects(bindRepository(db, { organizationId: 'org-a', userId: 'owner-a', projectId: 'project-a', installationId: 10, repositoryId: 42, userAccessToken: oauth }, async (...args) => {
    const response = await respond(...args)
    sql.exec("UPDATE boing_organizations SET status='suspended' WHERE id='org-a'")
    return response
  }), /unavailable/)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_github_repositories').get().n, 0)
})
test('installation and repository writes reject a changed WorkOS membership binding', async () => {
  const { db, sql } = database(), now = 1000
  sql.exec(`CREATE TABLE boing_workos_membership_bindings(organization_id TEXT,user_id TEXT,workos_membership_id TEXT,workos_updated_at TEXT);
    INSERT INTO boing_workos_membership_bindings VALUES('org-a','owner-a','membership1','v1')`)
  const membershipBinding = { role: 'owner', membershipId: 'membership1', membershipUpdatedAt: 'v1' }
  const state = await issueInstallationState(db, { organizationId: 'org-a', userId: 'owner-a', now })
  const respond = github()
  await assert.rejects(completeInstallation(db, { state, userId: 'owner-a', installationId: 10, appId: 55, userAccessToken: oauth, now: now + 1, membershipBinding }, async (...args) => {
    const result = await respond(...args)
    sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='v2'")
    return result
  }), /access was revoked/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_installations').get().n, 0)
  sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='v1'")
  const next = await issueInstallationState(db, { organizationId: 'org-a', userId: 'owner-a', now })
  await completeInstallation(db, { state: next, userId: 'owner-a', installationId: 10, appId: 55, userAccessToken: oauth, now: now + 1, membershipBinding }, respond)
  await assert.rejects(bindRepository(db, { organizationId: 'org-a', userId: 'owner-a', projectId: 'project-a', installationId: 10, repositoryId: 42, userAccessToken: oauth, membershipBinding }, async (...args) => {
    const result = await respond(...args)
    sql.exec("UPDATE boing_workos_membership_bindings SET workos_updated_at='v2'")
    return result
  }), /access is unavailable/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_repositories').get().n, 0)
})
test('repository rebinding and installation status changes advance source revisions atomically',async()=>{
  const {db,sql}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github())
  const args={organizationId:'org-a',userId:'owner-a',projectId:'project-a',installationId:10,repositoryId:42,userAccessToken:oauth}
  sql.exec("INSERT INTO boing_snapshots VALUES('project-a','old private data','now')")
  await bindRepository(db,args,github())
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_snapshots').get().n,1)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_snapshot_invalidations').get().n,1)
  const revision=()=>sql.prepare("SELECT revision FROM boing_source_versions WHERE project_id='project-a' AND kind='github'").get().revision
  assert.equal(revision(),1)
  await bindRepository(db,{...args,repositoryId:43},github({repositories:[{id:43,full_name:'org/other'}]}))
  await bindRepository(db,args,github())
  assert.equal(revision(),3)
  assert.equal(await setInstallationStatus(db,10,'suspended'),true)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boing_snapshots').get().n,1)
  assert.equal(await setInstallationStatus(db,10,'active'),true)
  assert.equal(revision(),5)
  assert.equal(await setInstallationStatus(db,10,'active'),false)
  assert.equal(revision(),5)
  sql.exec("CREATE TRIGGER reject_version BEFORE UPDATE ON boing_source_versions BEGIN SELECT RAISE(ABORT,'version failed'); END")
  await assert.rejects(setInstallationStatus(db,10,'deleted'),/version failed/)
  assert.equal(sql.prepare('SELECT status FROM boing_github_installations WHERE installation_id=10').get().status,'active')
})
test('installation state is one-time, user-bound, and does not permit replay',async()=>{
  const {db}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await assert.rejects(completeInstallation(db,{state,userId:'owner-b',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github()),/state/)
  const result=await completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+2},github())
  assert.deepEqual(result,{organizationId:'org-a',installationId:10,accountLogin:'octo'})
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+3},github()),/state/)
})

test('membership revocation, expiration and non-owners fail closed',async()=>{
  const {db,sql}=database(),now=1000
  await assert.rejects(issueInstallationState(db,{organizationId:'org-a',userId:'member',now}),/owner/)
  await assert.rejects(issueInstallationState(db,{organizationId:'org-a',userId:'suspended',now}),/owner/)
  await assert.rejects(issueInstallationState(db,{organizationId:'org-a',userId:'unknown',now}),/owner/)
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+600001},github()),/state/)
  const state2=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner-a'")
  await assert.rejects(completeInstallation(db,{state:state2,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github()),/owner/)
})

test('installation must belong to the app and user, and cannot move across tenants',async()=>{
  const {db}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github({appId:99})),/not authorized/)
  const state2=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state:state2,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github())
  const state3=await issueInstallationState(db,{organizationId:'org-b',userId:'owner-b',now})
  await assert.rejects(completeInstallation(db,{state:state3,userId:'owner-b',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github()),/another workspace/)
})

test('repository binding requires correct tenant, active project and user-visible repository',async()=>{
  const {db}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github())
  const args={organizationId:'org-a',userId:'owner-a',projectId:'project-a',installationId:10,repositoryId:42,userAccessToken:oauth}
  await assert.rejects(bindRepository(db,{...args,projectId:'project-b'},github()),/unavailable/)
  await assert.rejects(bindRepository(db,{...args,repositoryId:43},github()),/not authorized/)
  const result=await bindRepository(db,args,github())
  assert.deepEqual(result,{organizationId:'org-a',projectId:'project-a',installationId:10,repositoryId:42,fullName:'org/repo'})
  assert.equal(JSON.stringify(result).includes(oauth),false)
})

test('repository listing rechecks project authorization before exposing private names',async()=>{
  const {db,sql}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github())
  const args={organizationId:'org-a',userId:'owner-a',projectId:'project-a',installationId:10,userAccessToken:oauth}
  const respond=github({repositories:[{id:42,full_name:'org/private',private:true,secret:'omitted'},{id:43,full_name:'org/public',private:false}]})
  assert.deepEqual(await listAvailableRepositories(db,args,respond),[{id:42,fullName:'org/private',private:true},{id:43,fullName:'org/public',private:false}])
  await assert.rejects(listAvailableRepositories(db,{...args,projectId:'project-b'},respond),/unavailable/)
  await assert.rejects(listAvailableRepositories(db,args,async(...requestArgs)=>{
    const response=await respond(...requestArgs)
    sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner-a'")
    return response
  }),/unavailable/)
})

test('GitHub redirects fail closed without binding an installation',async()=>{
  const {db,sql}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  let calls=0
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},async(_url,options)=>{
    calls++
    assert.equal(options.redirect,'manual')
    return new Response(null,{status:302,headers:{location:'https://evil.test/'}})
  }),/verification failed/)
  assert.equal(calls,1)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_installations').get().n,0)
})

test('revocation during GitHub calls is rechecked atomically at the final write',async()=>{
  const {db,sql}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  const respond=github()
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},async(...args)=>{
    const response=await respond(...args)
    sql.exec("UPDATE boing_memberships SET status='suspended' WHERE user_id='owner-a'")
    return response
  }),/revoked/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_installations').get().n,0)
  sql.exec("UPDATE boing_memberships SET status='active' WHERE user_id='owner-a'")
  const state2=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state:state2,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},respond)
  const args={organizationId:'org-a',userId:'owner-a',projectId:'project-a',installationId:10,repositoryId:42,userAccessToken:oauth}
  await assert.rejects(bindRepository(db,args,async(...requestArgs)=>{
    const response=await respond(...requestArgs)
    sql.exec("UPDATE boing_projects SET status='archived' WHERE id='project-a'")
    return response
  }),/unavailable/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_repositories').get().n,0)
})

test('admin must have project grant, including at repository write time',async()=>{
  const {db,sql}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github())
  const args={organizationId:'org-a',userId:'admin',projectId:'project-a',installationId:10,repositoryId:42,userAccessToken:oauth}
  await assert.rejects(bindRepository(db,args,github()),/unavailable/)
  sql.exec("INSERT INTO boing_project_memberships VALUES('org-a','project-a','admin','now')")
  const respond=github()
  await assert.rejects(bindRepository(db,args,async(...requestArgs)=>{
    const response=await respond(...requestArgs)
    sql.exec("DELETE FROM boing_project_memberships WHERE project_id='project-a' AND user_id='admin'")
    return response
  }),/unavailable/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_repositories').get().n,0)
  sql.exec("INSERT INTO boing_project_memberships VALUES('org-a','project-a','admin','now')")
  assert.equal((await bindRepository(db,args,github())).projectId,'project-a')
})

test('a suspended Boing identity is denied at issue, consume and final write, independent of membership',async()=>{
  const {db,sql}=database(),now=1000
  const state=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner-a'")
  await assert.rejects(issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now}),/owner/)
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},github()),/owner/)
  sql.exec("UPDATE boing_identities SET status='active' WHERE user_id='owner-a'")
  // The consumed state is not reusable after the failed attempt.
  await assert.rejects(completeInstallation(db,{state,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+2},github()),/state/)
  const state2=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  const respond=github()
  await assert.rejects(completeInstallation(db,{state:state2,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},async(...args)=>{
    const response=await respond(...args)
    sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner-a'")
    return response
  }),/revoked/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_installations').get().n,0)
  sql.exec("UPDATE boing_identities SET status='active' WHERE user_id='owner-a'")
  const state3=await issueInstallationState(db,{organizationId:'org-a',userId:'owner-a',now})
  await completeInstallation(db,{state:state3,userId:'owner-a',installationId:10,appId:55,userAccessToken:oauth,now:now+1},respond)
  const args={organizationId:'org-a',userId:'owner-a',projectId:'project-a',installationId:10,repositoryId:42,userAccessToken:oauth}
  await assert.rejects(bindRepository(db,args,async(...requestArgs)=>{
    const response=await respond(...requestArgs)
    sql.exec("UPDATE boing_identities SET status='suspended' WHERE user_id='owner-a'")
    return response
  }),/unavailable/)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM boing_github_repositories').get().n,0)
})

test('install states reference Boing identities, not legacy users',async()=>{
  const {sql}=database()
  assert.throws(()=>sql.prepare('INSERT INTO boing_github_install_states VALUES(?,?,?,?,NULL)').run('h','org-a','unknown',1),/FOREIGN KEY/)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='users'").get().n,0)
})

test('webhook validates HMAC of exact raw bytes and rejects invalid signatures',async()=>{
  const body=new TextEncoder().encode('Hello, World!'),secret="It's a Secret to Everybody"
  const signature='sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17'
  assert.equal(await verifyGitHubWebhook(body,signature,secret),true)
  assert.equal(await verifyGitHubWebhook(new TextEncoder().encode('Hello, World?'),signature,secret),false)
  assert.equal(await verifyGitHubWebhook(body,'sha1=abc',secret),false)
  assert.equal(await verifyGitHubWebhook(body,signature,''),false)
})
