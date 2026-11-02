import {notifyAccessDecision} from './decision-email.mjs'
import {scheduleWorkosAudit} from './workos-audit-log.mjs'
import {isDashboardOwner} from './owner-identity.mjs'
import {readBody} from './request-body.mjs'
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})
const photoCache=new WeakMap()

function photoUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:'&&url.hostname==='workoscdn.com'&&!url.username&&!url.password&&!url.port?url.href:null } catch { return null }
}

// Bound provider reads even when the shared WorkOS environment has many users.
// Only photos for dashboard users are returned; provider errors leave initials.
async function userPhotos(env,users,viewer,request) {
  const photos=new Map(), ids=new Set(users.map(entry=>entry.id))
  const own=photoUrl(viewer.profilePictureUrl)
  if(own&&ids.has(viewer.id))photos.set(viewer.id,own)
  if(!env.WORKOS_API_KEY || !ids.size)return photos
  const cached=photoCache.get(env)
  if(cached && cached.expires>Date.now() && [...ids].every(id=>cached.ids.has(id))) {
    for(const [id,photo] of cached.photos) if(ids.has(id)&&!photos.has(id))photos.set(id,photo)
    return photos
  }
  try {
    let after='',complete=false
    const fetched=new Map()
    for(let page=0;page<2;page++) {
      const url=new URL('https://api.workos.com/user_management/users')
      url.searchParams.set('limit','100')
      if(after)url.searchParams.set('after',after)
      const response=await request(url.href,{headers:{authorization:`Bearer ${env.WORKOS_API_KEY}`},redirect:'manual',signal:AbortSignal.timeout(4000)})
      if(!response.ok)break
      const body=await response.json()
      if(!Array.isArray(body.data))break
      for(const item of body.data) {
        const photo=photoUrl(item?.profile_picture_url)
        if(ids.has(item?.id)&&photo)fetched.set(item.id,photo)
      }
      after=body.list_metadata?.after
      if(!after){complete=true;break}
      if(typeof after!=='string'||after.length>200)break
    }
    for(const [id,photo] of fetched) if(!photos.has(id))photos.set(id,photo)
    if(complete)photoCache.set(env,{ids,photos:fetched,expires:Date.now()+300000})
  } catch {}
  return photos
}

export async function manageAccess(request,env,user,fetcher=fetch,ctx) {
  if(!user||user.status!=='approved'||user.verified!==1||(env.WORKOS_RBAC_ENABLED==='true'?user.canManageAccess!==true:!isDashboardOwner(user,env)))return reply({error:'owner_required'},403)
  if(request.method==='GET') {
    const result=await env.DB.prepare('SELECT id,name,email,status,created_at,decided_at FROM users ORDER BY created_at DESC LIMIT 200').all()
    const photos=await userPhotos(env,result.results,user,fetcher)
    return reply({users:result.results.map(entry=>({...entry,profilePictureUrl:photos.get(entry.id)??null})),shareUrl:env.APP_URL+'/overview',ownerId:result.results.find(entry=>isDashboardOwner(entry,env))?.id??null})
  }
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405)
  if(request.headers.get('origin')!==env.APP_URL)return reply({error:'invalid_origin'},403)
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'json_required'},415)
  const body=await readBody(request,2048)
  if(body===null)return reply({error:'too_large'},413)
  let input
  try{input=JSON.parse(body)}catch{return reply({error:'invalid_request'},400)}
  if(!input||Object.keys(input).some(key=>!['id','decision'].includes(key))||typeof input.id!=='string'||!input.id||input.id.length>200||!['approved','denied'].includes(input.decision)||input.id===user.id)return reply({error:'invalid_request'},400)
  const current=await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(input.id).first()
  if(!current||current.status===input.decision||!['pending','approved','denied'].includes(current.status))return reply({error:'unchanged'},409)
  // pending -> approved/denied, approved -> denied (revoke), denied -> approved (undo).
  const auditAction=current.status==='approved'&&input.decision==='denied'?'revoked':current.status==='denied'&&input.decision==='approved'?'reinstated':input.decision
  const at=new Date().toISOString()
  const ownerId=/^user_[A-Za-z0-9]+$/.test(env.WORKOS_OWNER_USER_ID??'')?env.WORKOS_OWNER_USER_ID:''
  const results=await env.DB.batch([
    env.DB.prepare('UPDATE users SET status=?,decided_at=?,decided_by=? WHERE id=? AND status=? AND id<>? AND (?<>\'\' OR email<>?)').bind(input.decision,at,user.id,input.id,current.status,ownerId,ownerId,env.OWNER_EMAIL),
    env.DB.prepare('INSERT INTO audit(id,user_id,action,actor,created_at) SELECT ?,id,?,?,? FROM users WHERE changes()=1 AND id=? AND decided_at=? AND decided_by=? AND status=?').bind(crypto.randomUUID(),auditAction,user.id,at,input.id,at,user.id,input.decision)
  ])
  if(results[0].meta?.changes!==1)return reply({error:'unchanged'},409)
  const auditName={approved:'egm.access.approved',denied:'egm.access.denied',revoked:'egm.access.revoked',reinstated:'egm.access.reinstated'}[auditAction]
  if(auditName) scheduleWorkosAudit(env,{action:auditName,actorId:user.id,actorName:user.name,targetId:input.id,targetType:'user',metadata:{from_status:current.status,to_status:input.decision}},request,promise=>ctx?.waitUntil?.(promise))
  // Only a pending decision is new information for the requester. Revoke and reinstate stay quiet.
  if(current.status==='pending')ctx?.waitUntil?.(notifyAccessDecision(env,{userId:input.id,decision:input.decision,fromStatus:'pending'},ctx.decisionEmailFetcher).catch(error=>console.error('Decision email failed',error?.message)))
  return reply({ok:true,action:auditAction})
}
