// Additive schema only. Apply using the repository's reviewed migration process.
// Never store GitHub user or installation tokens in these tables. Users are
// Boing identities (boing_identities, see boing-identity.mjs); this schema has
// no dependency on the legacy users table.
export const GITHUB_APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS boing_github_install_states (
  state_hash TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  user_id TEXT NOT NULL REFERENCES boing_identities(user_id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS boing_github_installations (
  installation_id INTEGER PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  github_account_id INTEGER NOT NULL,
  github_account_login TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','suspended','deleted')),
  UNIQUE(organization_id, installation_id)
);
CREATE TABLE IF NOT EXISTS boing_github_repositories (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  repository_full_name TEXT NOT NULL,
  PRIMARY KEY(organization_id, project_id),
  FOREIGN KEY(organization_id, project_id) REFERENCES boing_projects(organization_id, id),
  FOREIGN KEY(organization_id, installation_id) REFERENCES boing_github_installations(organization_id, installation_id)
);
-- Older mixed-source snapshots have no source revisions. Preserve their data
-- but hide them after any source change until an explicit migration replaces
-- them with revision-aware material.
CREATE TABLE IF NOT EXISTS boing_snapshot_invalidations (
  project_id TEXT PRIMARY KEY REFERENCES boing_projects(id)
);`

const githubHeaders={accept:'application/vnd.github+json','user-agent':'boing-growth','x-github-api-version':'2022-11-28'}
const maxPages=5
const stateLifetimeMs=10*60*1000

function identity(value,name) {
  if(typeof value!=='string' || !value || value.length>256) throw new Error(`Invalid ${name}`)
  return value
}

function positiveInteger(value,name) {
  if(!Number.isSafeInteger(value) || value<1) throw new Error(`Invalid ${name}`)
  return value
}

function token(value) {
  if(typeof value!=='string' || !value || value.length>4096 || /[\r\n]/.test(value)) throw new Error('GitHub authorization unavailable')
  return value
}

async function stateHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
}

// Authority requires an active Boing identity, an active owner/admin
// membership and an active organization, evaluated together in one statement.
const ownerAccess="m.organization_id=? AND m.user_id=? AND m.role IN ('owner','admin') AND m.status='active' AND o.status='active' AND u.status='active'"
const ownerJoin="boing_memberships m JOIN boing_organizations o ON o.id=m.organization_id JOIN boing_identities u ON u.user_id=m.user_id"
const bindingGuard = binding => binding ? ` AND m.role=? AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=m.organization_id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''
const bindingValues = binding => binding ? [binding.role, binding.membershipId, binding.membershipUpdatedAt] : []

async function requireOwner(db,organizationId,userId) {
  identity(organizationId,'organization'); identity(userId,'user')
  const membership=await db.prepare(`SELECT m.role FROM ${ownerJoin} WHERE ${ownerAccess}`).bind(organizationId,userId).first()
  if(!membership) throw new Error('Workspace owner or admin access required')
}

// organizationId must be resolved from a route and authorization checked here;
// it is stored on the server and never taken from the callback query.
export async function issueInstallationState(db,{organizationId,userId,now=Date.now()}) {
  await requireOwner(db,organizationId,userId)
  const random=crypto.getRandomValues(new Uint8Array(32))
  const state=Array.from(random,b=>b.toString(16).padStart(2,'0')).join('')
  await db.prepare('DELETE FROM boing_github_install_states WHERE state_hash IN (SELECT state_hash FROM boing_github_install_states WHERE expires_at<=? OR consumed_at IS NOT NULL LIMIT 100)').bind(now).run()
  const inserted=await db.prepare(`INSERT INTO boing_github_install_states (state_hash,organization_id,user_id,expires_at)
    SELECT ?,?,?,? WHERE (SELECT count(*) FROM boing_github_install_states WHERE user_id=? AND organization_id=? AND expires_at>? AND consumed_at IS NULL)<3
    AND (SELECT count(*) FROM boing_github_install_states WHERE organization_id=? AND expires_at>? AND consumed_at IS NULL)<20
    AND EXISTS (SELECT 1 FROM ${ownerJoin} WHERE ${ownerAccess})`)
    .bind(await stateHash(state),organizationId,userId,now+stateLifetimeMs,userId,organizationId,now,organizationId,now,organizationId,userId).run()
  if(inserted.meta?.changes!==1) throw new Error('Installation authorization unavailable')
  return state
}

// Atomic single-use claim, tied to the current signed-in user. If verification
// fails downstream, the owner must begin again with a fresh state.
async function consumeState(db,state,userId,now) {
  if(typeof state!=='string' || !/^[0-9a-f]{64}$/.test(state)) throw new Error('Invalid installation state')
  identity(userId,'user')
  const row=await db.prepare('UPDATE boing_github_install_states SET consumed_at=? WHERE state_hash=? AND user_id=? AND consumed_at IS NULL AND expires_at>? RETURNING organization_id').bind(now,await stateHash(state),userId,now).first()
  if(!row) throw new Error('Installation state expired, used, or invalid')
  await requireOwner(db,row.organization_id,userId)
  return row.organization_id
}

async function githubList(path,key,accessToken,request) {
  token(accessToken)
  const rows=[]
  for(let page=1;page<=maxPages;page++) {
    let response
    try {
      response=await request(`https://api.github.com${path}?per_page=100&page=${page}`,{headers:{...githubHeaders,authorization:`Bearer ${accessToken}`},redirect:'manual',signal:AbortSignal.timeout(10000)})
    } catch { throw new Error('GitHub authorization verification failed') }
    if(!response.ok) throw new Error('GitHub authorization verification failed')
    const result=await response.json()
    if(!Array.isArray(result[key])) throw new Error('Invalid GitHub authorization response')
    rows.push(...result[key])
    if(result[key].length<100) return rows
  }
  throw new Error('GitHub authorization results exceeded pagination limit')
}

// Lists only repositories visible to the GitHub user in an installation already
// bound to this workspace. The token must come from a server-side OAuth flow.
// Recheck access after the network request before returning private repo names.
export async function listAvailableRepositories(db,{organizationId,userId,projectId,installationId,userAccessToken},request=fetch) {
  identity(organizationId,'organization'); identity(userId,'user'); identity(projectId,'project')
  positiveInteger(installationId,'installation')
  const access=async()=>db.prepare(`SELECT p.id FROM ${ownerJoin}
    JOIN boing_projects p ON p.organization_id=o.id
    JOIN boing_github_installations i ON i.organization_id=o.id
    WHERE ${ownerAccess} AND p.id=? AND p.status='active'
      AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=p.organization_id AND pm.project_id=p.id AND pm.user_id=m.user_id))
      AND i.installation_id=? AND i.status='active'`).bind(organizationId,userId,projectId,installationId).first()
  if(!await access()) throw new Error('Project or installation unavailable')
  const repositories=await githubList(`/user/installations/${installationId}/repositories`,'repositories',userAccessToken,request)
  if(!await access()) throw new Error('Project or installation unavailable')
  return repositories.filter(row=>Number.isSafeInteger(row?.id) && row.id>0 && typeof row.full_name==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(row.full_name) && typeof row.private==='boolean')
    .map(row=>({id:row.id,fullName:row.full_name,private:row.private}))
}

// The access token must be acquired server-side in a GitHub App OAuth flow
// bound to the same signed-in Boing user. Never accept it from request JSON.
export async function completeInstallation(db,{state,userId,installationId,appId,userAccessToken,now=Date.now(),membershipBinding=null},request=fetch) {
  positiveInteger(installationId,'installation'); positiveInteger(appId,'app')
  const organizationId=await consumeState(db,state,userId,now)
  const installations=await githubList('/user/installations','installations',userAccessToken,request)
  const installation=installations.find(row=>row.id===installationId && row.app_id===appId && !row.suspended_at)
  if(!installation || !Number.isSafeInteger(installation.account?.id) || typeof installation.account?.login!=='string' || !installation.account.login) throw new Error('Installation not authorized for this user')
  // Conflict on a different organization is rejected, never silently moved.
  const result=await db.batch([
    db.prepare(`INSERT INTO boing_github_installations (installation_id,organization_id,github_account_id,github_account_login,status) SELECT ?,?,?,?,'active' WHERE EXISTS (SELECT 1 FROM ${ownerJoin} WHERE ${ownerAccess}${bindingGuard(membershipBinding)}) ON CONFLICT(installation_id) DO UPDATE SET github_account_id=excluded.github_account_id,github_account_login=excluded.github_account_login,status='active' WHERE boing_github_installations.organization_id=excluded.organization_id`).bind(installationId,organizationId,installation.account.id,installation.account.login,organizationId,userId,...bindingValues(membershipBinding)),
    db.prepare(`INSERT INTO boing_source_versions(project_id,kind,revision)
      SELECT project_id,'github',1 FROM boing_github_repositories
      WHERE installation_id=? AND organization_id=? AND changes()=1
      ON CONFLICT(project_id,kind) DO UPDATE SET revision=revision+1`).bind(installationId,organizationId),
    db.prepare(`INSERT INTO boing_snapshot_invalidations(project_id) SELECT project_id FROM boing_github_repositories WHERE installation_id=? AND organization_id=? AND changes()>0 ON CONFLICT(project_id) DO NOTHING`).bind(installationId,organizationId)
  ])
  if(result[0].meta?.changes!==1) throw new Error('Installation already belongs to another workspace or access was revoked')
  return {organizationId,installationId,accountLogin:installation.account.login}
}

// The installation and project must both belong to the authorized workspace.
// User OAuth visibility is rechecked at selection time; no arbitrary repo ID is
// accepted solely from a client request.
export async function bindRepository(db,{organizationId,userId,projectId,installationId,repositoryId,userAccessToken,membershipBinding=null},request=fetch) {
  await requireOwner(db,organizationId,userId)
  identity(projectId,'project'); positiveInteger(installationId,'installation'); positiveInteger(repositoryId,'repository')
  const installation=await db.prepare("SELECT installation_id FROM boing_github_installations WHERE installation_id=? AND organization_id=? AND status='active'").bind(installationId,organizationId).first()
  const project=await db.prepare("SELECT p.id FROM boing_projects p JOIN boing_memberships m ON m.organization_id=p.organization_id WHERE p.id=? AND p.organization_id=? AND p.status='active' AND m.user_id=? AND m.status='active' AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=p.organization_id AND pm.project_id=p.id AND pm.user_id=m.user_id))").bind(projectId,organizationId,userId).first()
  if(!installation || !project) throw new Error('Project or installation unavailable')
  const repositories=await githubList(`/user/installations/${installationId}/repositories`,'repositories',userAccessToken,request)
  const repository=repositories.find(row=>row.id===repositoryId && typeof row.full_name==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(row.full_name))
  if(!repository) throw new Error('Repository not authorized for this user')
  const saved=await db.batch([
    db.prepare(`INSERT INTO boing_github_repositories (organization_id,project_id,installation_id,repository_id,repository_full_name) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ${ownerJoin} JOIN boing_projects p ON p.organization_id=o.id JOIN boing_github_installations i ON i.organization_id=o.id WHERE ${ownerAccess} AND p.id=? AND p.status='active' AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=p.organization_id AND pm.project_id=p.id AND pm.user_id=m.user_id)) AND i.installation_id=? AND i.status='active'${bindingGuard(membershipBinding)}) ON CONFLICT(organization_id,project_id) DO UPDATE SET installation_id=excluded.installation_id,repository_id=excluded.repository_id,repository_full_name=excluded.repository_full_name`).bind(organizationId,projectId,installationId,repositoryId,repository.full_name,organizationId,userId,projectId,installationId,...bindingValues(membershipBinding)),
    db.prepare(`INSERT INTO boing_source_versions(project_id,kind,revision) SELECT ?,'github',1 WHERE changes()=1 ON CONFLICT(project_id,kind) DO UPDATE SET revision=revision+1`).bind(projectId),
    db.prepare('INSERT INTO boing_snapshot_invalidations(project_id) SELECT ? WHERE changes()=1 ON CONFLICT(project_id) DO NOTHING').bind(projectId)
  ])
  if(saved[0].meta?.changes!==1) throw new Error('Project, installation, or access is unavailable')
  return {organizationId,projectId,installationId,repositoryId,fullName:repository.full_name}
}

// Trusted webhook integration must verify the raw signature, event and app
// identity before calling this. No client-provided installation status grants
// authority. Even reactivation advances the revision to prevent ABA leaks.
export async function setInstallationStatus(db, installationId, status) {
  positiveInteger(installationId,'installation')
  if(!['suspended','deleted','active'].includes(status)) throw new Error('Invalid installation status')
  const result=await db.batch([
    db.prepare('UPDATE boing_github_installations SET status=? WHERE installation_id=? AND status<>?').bind(status,installationId,status),
    db.prepare(`INSERT INTO boing_source_versions(project_id,kind,revision)
      SELECT project_id,'github',1 FROM boing_github_repositories WHERE installation_id=? AND changes()=1
      ON CONFLICT(project_id,kind) DO UPDATE SET revision=revision+1`).bind(installationId),
    db.prepare('INSERT INTO boing_snapshot_invalidations(project_id) SELECT project_id FROM boing_github_repositories WHERE installation_id=? AND changes()>0 ON CONFLICT(project_id) DO NOTHING').bind(installationId)
  ])
  return result[0].meta?.changes===1
}

// Verify raw bytes before JSON parsing. Event headers and delivery IDs are not
// signed, so callers must validate event shape and handle replay idempotently.
export async function verifyGitHubWebhook(rawBody,signature,secret) {
  if(!(rawBody instanceof Uint8Array) || rawBody.byteLength>1024*1024 || typeof signature!=='string' || !/^sha256=[0-9a-f]{64}$/.test(signature) || typeof secret!=='string' || !secret) return false
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
  const bytes=Uint8Array.from(signature.slice(7).match(/../g),part=>parseInt(part,16))
  return crypto.subtle.verify('HMAC',key,bytes,rawBody)
}
