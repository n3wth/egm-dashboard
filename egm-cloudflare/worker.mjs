import {validatePresentation} from '../egm-performance/src/presentation-state.js'
import {runRefresh} from './refresh-runner.mjs'
import {flushApprovalEvents} from './approval-events.mjs'
import {flushGrokNotifications} from './grok-notify.mjs'
import {sendGrowthUpdateEmail,unsubscribeGrowthEmail} from './growth-update-email.mjs'
import {flushFeedbackEvents,flushFeedbackToPosthog,loadFeedbackSurvey,recordFeedbackActivity,submitFeedback} from './feedback-events.mjs'
import {mcp} from './mcp-server.mjs'
import {renderAccessPage} from './auth-pages.mjs'
import {cachedSiteIcon} from './favicon-cache.mjs'
import {SITE_NAME,siteMeta} from './site-meta.mjs'
import {handleAsk} from './ask.mjs'
import {manageAccess} from './access-management.mjs'
import {invitationForOtherAccount,invitationHash,manageInvitations,redeemInvitation,validInvitationToken} from './invitations.mjs'
import {rbacConfigured,workosSessionConfigured,storeWorkosSession,validatedWorkosSession,workosAdminPermission,sessionSecrets,revokeWorkosSession} from './workos-session.mjs'
import {syncWorkosMember,syncWorkosMemberships} from './workos-membership.mjs'
import {isDashboardOwner} from './owner-identity.mjs'
import {readVerifiedWorkosEmail,reconcileVerifiedEmail} from './workos-identity.mjs'
import {cachedWorkosRead} from './workos-request-cache.mjs'
import {issueUserSessionsWidgetToken} from './workos-widgets.mjs'
import {accessLive,accessChanged} from './access-live.mjs'
import {readBody} from './request-body.mjs'
import {capturePosthogEvent} from './ai-analytics.mjs'
import {scheduleWorkosAudit} from './workos-audit-log.mjs'
import {auditAccessRequested} from './approval-events.mjs'
import {handleWorkosWebhook} from './workos-webhooks.mjs'
export {AccessLive} from './access-live.mjs'
import seed from '../egm-performance/src/data.json' with {type:'json'}
const enc = new TextEncoder()
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const un64 = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0))
const now = () => Math.floor(Date.now()/1000)
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)))
const key = secret => crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])
// Sign with the current secret only; a list is accepted so callers can pass sessionSecrets(env).
export async function seal(payload,secrets,audience,lifetime=3600) {
  const secret=[].concat(secrets)[0]
  const header=b64(enc.encode(JSON.stringify({alg:'HS256',typ:'JWT'})))
  const body=b64(enc.encode(JSON.stringify({...payload,iss:'egm-growth',aud:audience,iat:now(),exp:now()+lifetime})))
  const data=`${header}.${body}`
  return `${data}.${b64(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(data)))}`
}
export async function open(token,secrets,audience) {
  try {
    if(!token || token.length>8192) return null
    const [h,p,s,...extra]=token.split('.')
    if(extra.length || JSON.parse(new TextDecoder().decode(un64(h))).alg!=='HS256') return null
    let valid=false
    for(const secret of [].concat(secrets)) if(await crypto.subtle.verify('HMAC',await key(secret),un64(s),enc.encode(`${h}.${p}`))) {valid=true;break}
    if(!valid) return null
    const value=JSON.parse(new TextDecoder().decode(un64(p)))
    return value.iss==='egm-growth' && value.aud===audience && value.exp>now() ? value : null
  } catch { return null }
}
const cookie = (name,value,age=3600) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`
// The signed cookie ends 30 days after sign-in. The session row ends 7 days after the last visit, never after the cookie.
const SESSION_IDLE=7*86400, SESSION_MAX=30*86400, SESSION_RENEW_STEP=3600
// The invitation outlives one sign-in attempt so a failed or slow attempt can return to it.
const inviteLifetime = 3600
const inviteCookie = async (token,env) => cookie('__Host-egm_invite',await seal({token},env.SESSION_SECRET,'invitation',inviteLifetime),inviteLifetime)
const cookieValue = (request,name) => request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)
const navigation = (request,url) => request.method==='GET' && !url.pathname.startsWith('/api/') && (!/\.[a-z0-9]+$/i.test(url.pathname) || /\.html$/i.test(url.pathname))
const unavailable = request => navigation(request,new URL(request.url)) ? renderAccessPage('unavailable',new URL(request.url).pathname==='/auth/callback'?{href:cookieValue(request,'__Host-egm_invite')?'/auth/invite':'/auth/login'}:{}) : new Response('Temporarily unavailable',{status:503,headers:{'cache-control':'no-store'}})
const hashedAsset = /^\/assets\/[\w.-]+-[\w-]{8}\.(js|css|woff2|svg|png|wasm)$/
const assetTypes={js:['text/javascript','application/javascript'],css:['text/css'],woff2:['font/woff2','application/font-woff2'],svg:['image/svg+xml'],png:['image/png'],wasm:['application/wasm']}
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store',...headers}})
export function profilePhoto(value) {
  try {const url=new URL(value);return typeof value==='string'&&value.length<=2048&&url.protocol==='https:'&&url.hostname==='workoscdn.com'&&!url.port&&!url.username&&!url.password?url.href:null}catch{return null}
}
async function identity(request,env) {
  const session=await open(cookieValue(request,'__Host-egm_session'),sessionSecrets(env),'session')
  if(!session || typeof session.sid!=='string') return null
  const row=await env.DB.prepare('SELECT users.*,sessions.expires_at AS session_expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=? AND sessions.expires_at>?').bind(session.sid,now()).first()
  if(!row) return null
  const {session_expires_at:expiresAt,...user}=row
  const identity={...user,sessionId:session.sid,profilePictureUrl:profilePhoto(session.profilePictureUrl)}
  if(env.WORKOS_WIDGETS_ENABLED==='true') {
    const load=async()=>{
      const [current,email]=await Promise.all([
        validatedWorkosSession(env,session.sid,user.id),
        readVerifiedWorkosEmail(env,user.id)
      ])
      return {cacheable:current.status==='active'&&!!email,current,email}
    }
    const checked=Number(env.WORKOS_CHECK_CACHE_MS)>0
      ? await cachedWorkosRead(env,`session:${session.sid}:${user.id}`,Number(env.WORKOS_CHECK_CACHE_MS),load)
      : await load()
    const {current,email}=checked
    if(current.status==='revoked') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM workos_sessions WHERE session_id=? AND user_id=?').bind(session.sid,user.id),
        env.DB.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').bind(session.sid,user.id)
      ])
      return null
    }
    if(current.status==='reauthenticate') return null
    if(current.status!=='active' || !email) return {sessionUnavailable:true}
    if(await reconcileVerifiedEmail(env,user,email)==='conflict') return {identityConflict:true}
    identity.email=email
    identity.workosAccessToken=current.accessToken
  }
  const renewed=Math.min(now()+SESSION_IDLE,session.exp)
  if(renewed-expiresAt>=SESSION_RENEW_STEP) try { await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE id=? AND user_id=? AND expires_at<?').bind(renewed,session.sid,user.id,renewed).run() } catch {}
  return identity
}
async function accessDecision(user,env) {
  if (!user || user.status!=='approved' || user.verified!==1) return 'denied'
  if (env.WORKOS_RBAC_ENABLED!=='true') return isDashboardOwner(user,env) ? 'allowed' : 'denied'
  if (!rbacConfigured(env)) return 'denied'
  try {
    const load=()=>workosAdminPermission(env,user.sessionId,user.id)
    const result=Number(env.WORKOS_CHECK_CACHE_MS)>0
      ? await cachedWorkosRead(env,`admin:${user.sessionId}`,Number(env.WORKOS_CHECK_CACHE_MS),async()=>{
        const permission=await load()
        return {cacheable:permission.status==='allowed'||permission.status==='denied',status:permission.status}
      })
      : await load()
    if (result.status==='allowed') return 'allowed'
    if (result.status==='retryable' || result.status==='unavailable') return 'unavailable'
    return 'denied'
  } catch { return 'unavailable' }
}
const ownerGate = decision => decision==='unavailable' ? json({error:'access_check_unavailable'},503) : decision==='allowed' ? null : json({error:'owner_required'},403)
export async function handle(request,env,ctx) {
  const url=new URL(request.url)
  if(url.origin!==env.APP_URL) return new Response('Not found',{status:404})
  if(['/favicon.svg','/og.png','/apple-touch-icon.png','/email/egm-mark-black.png','/email/egm-mark-white.png','/email/growth-chart-light.png','/email/growth-chart-dark.png'].includes(url.pathname) && ['GET','HEAD'].includes(request.method)) {
    const flushParam=url.searchParams.get('flush_growth_email')
    const previewOnly=flushParam==='preview' || url.searchParams.get('preview')==='1'
    if(url.pathname==='/favicon.svg' && flushParam) ctx?.waitUntil?.(sendGrowthUpdateEmail(env,{recipient:previewOnly?'newth@google.com':null,idempotencySuffix:flushParam==='1'?'v4':flushParam,force:flushParam==='force'||previewOnly}).catch(()=>{}))
    return env.ASSETS.fetch(request)
  }
  if(['/rive/egm-login.js','/rive/rive.js','/rive/rive.wasm','/rive/egm-handoff.riv'].includes(url.pathname) && ['GET','HEAD'].includes(request.method)) return env.ASSETS.fetch(request)
  if(['/fonts/SuisseIntl-Book.woff2','/fonts/SuisseIntl-Medium.woff2','/fonts/SuisseIntl-Semibold.woff2','/fonts/SuisseIntl-Bold.woff2'].includes(url.pathname) && ['GET','HEAD'].includes(request.method)) return env.ASSETS.fetch(request)
  if(url.pathname==='/webhooks/workos') return handleWorkosWebhook(request,env)
  if(!env.SESSION_SECRET || env.SESSION_SECRET.length<48) return unavailable(request)
  if(url.pathname==='/email/unsubscribe' && (request.method==='GET' || request.method==='POST')) {
    const token=url.searchParams.get('token')
    const result=await unsubscribeGrowthEmail(env,token,sessionSecrets(env)).catch(()=>({status:'error'}))
    if(request.method==='POST') return json({status:result.status},result.status==='unsubscribed'?200:400)
    return renderAccessPage(result.status==='unsubscribed'?'unsubscribed':'unsubscribe_invalid')
  }
  if(url.pathname==='/.well-known/oauth-protected-resource') return json({resource:env.APP_URL+'/mcp',authorization_servers:[env.WORKOS_AUTHKIT_DOMAIN],scopes_supported:['openid','email','profile'],bearer_methods_supported:['header'],resource_name:'EGM approvals'})
  if(url.pathname==='/mcp') return mcp(request,env,ctx)
  const pagePaths=['overview','reach','website','development','acquisition','adoption','research','mentions','egm-lite']
  // Renamed pages: Overview was Reach, and Growth advice moved into Ask.
  const moved=['reach','growth']
  if(moved.includes(url.pathname.slice(1)) && request.method==='GET') return new Response(null,{status:302,headers:{location:'/overview','cache-control':'no-store'}})
  if(url.pathname==='/' && url.searchParams.has('tab') && request.method==='GET' && [...pagePaths,'growth'].includes(url.searchParams.get('tab'))) {
    const tab=url.searchParams.get('tab')
    return new Response(null,{status:302,headers:{location:moved.includes(tab)?'/overview':'/'+tab,'cache-control':'no-store'}})
  }
  if(url.pathname==='/auth/logout') {
    if(request.method!=='POST') return new Response('Use POST',{status:405})
    if(request.headers.get('origin')!==env.APP_URL) return json({error:'invalid_origin'},403)
    const session=await open(cookieValue(request,'__Host-egm_session'),sessionSecrets(env),'session')
    const signedOut=session?.sid?await env.DB.prepare('SELECT user_id FROM sessions WHERE id=?').bind(session.sid).first():null
    if(session?.sid && (env.WORKOS_RBAC_ENABLED==='true' || env.WORKOS_WIDGETS_ENABLED==='true')) await revokeWorkosSession(env,session.sid)
    if(session?.sid && (env.WORKOS_RBAC_ENABLED==='true' || env.WORKOS_WIDGETS_ENABLED==='true')) try { await env.DB.prepare('DELETE FROM workos_sessions WHERE session_id=?').bind(session.sid).run() } catch {}
    if(session?.sid) await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(session.sid).run()
    if(signedOut?.user_id) scheduleWorkosAudit(env,{action:'egm.user.signed_out',actorId:signedOut.user_id,targetId:signedOut.user_id,targetType:'user'},request,promise=>ctx?.waitUntil?.(promise))
    const headers=new Headers({location:'/', 'cache-control':'private, no-store'})
    headers.append('set-cookie',cookie('__Host-egm_session','',0))
    headers.append('set-cookie',cookie('__Host-egm_flow','',0))
    headers.append('set-cookie',cookie('__Host-egm_invite','',0))
    return new Response(null,{status:303,headers})
  }
  if(url.pathname==='/auth/invite' && request.method==='GET') {
    const supplied=url.searchParams.get('invitation_token')
    const invitation=supplied ? {token:supplied} : await open(cookieValue(request,'__Host-egm_invite'),sessionSecrets(env),'invitation')
    if(!invitation) return renderAccessPage('invite_reopen')
    if(!validInvitationToken(invitation.token)) return renderAccessPage('invite_invalid')
    try {
      const active=await env.DB.prepare('SELECT id FROM invitations WHERE token_hash=? AND expires_at>? AND redeemed_at IS NULL AND revoked_at IS NULL').bind(await invitationHash(invitation.token),Date.now()).first()
      if(!active) return renderAccessPage('invite_invalid')
    } catch { return renderAccessPage('session_unavailable') }
    if(supplied) return new Response(null,{status:303,headers:{location:'/auth/invite','set-cookie':await inviteCookie(invitation.token,env),'cache-control':'private, no-store','referrer-policy':'no-referrer'}})
    return renderAccessPage('invite')
  }
  if((url.pathname==='/auth/login' && request.method==='GET') || (url.pathname==='/auth/invite/continue' && request.method==='POST')) {
    const continuing=url.pathname==='/auth/invite/continue'
    if(continuing && request.headers.get('origin')!==env.APP_URL) return json({error:'invalid_origin'},403)
    const invitation=continuing?await open(cookieValue(request,'__Host-egm_invite'),sessionSecrets(env),'invitation'):null
    const invitationToken=invitation?.token??null
    if(continuing) {
      if(!invitation) return renderAccessPage('invite_reopen')
      if(!validInvitationToken(invitationToken)) return renderAccessPage('invite_invalid')
      try {
        const active=await env.DB.prepare('SELECT id FROM invitations WHERE token_hash=? AND expires_at>? AND redeemed_at IS NULL AND revoked_at IS NULL').bind(await invitationHash(invitationToken),Date.now()).first()
        if(!active) return renderAccessPage('invite_invalid')
      } catch { return renderAccessPage('session_unavailable') }
    }
    const verifier=random(),state=random()
    const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier)))
    const auth=new URL('https://api.workos.com/user_management/authorize')
    for(const [k,v] of Object.entries({client_id:env.WORKOS_CLIENT_ID,provider:'GoogleOAuth',redirect_uri:env.APP_URL+'/auth/callback',response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256'})) auth.searchParams.set(k,v)
    const headers=new Headers({location:auth.href,'cache-control':'no-store','referrer-policy':'no-referrer'})
    headers.append('set-cookie',cookie('__Host-egm_flow',await seal({verifier,state,invitationToken},env.SESSION_SECRET,'login',600),600))
    if(continuing) headers.append('set-cookie',await inviteCookie(invitationToken,env))
    return new Response(null,{status:302,headers})
  }
  if(url.pathname==='/auth/callback' && request.method==='GET') {
    const flow=await open(cookieValue(request,'__Host-egm_flow'),sessionSecrets(env),'login')
    const clear=cookie('__Host-egm_flow','',0)
    // A failed attempt keeps a pending invitation so the person can retry without a new link.
    let invitationToken=flow?.invitationToken||(await open(cookieValue(request,'__Host-egm_invite'),sessionSecrets(env),'invitation'))?.token
    const fail=async page=>{
      const response=renderAccessPage(page,{href:invitationToken?'/auth/invite':'/auth/login'})
      response.headers.append('set-cookie',clear)
      response.headers.append('set-cookie',invitationToken?await inviteCookie(invitationToken,env):cookie('__Host-egm_invite','',0))
      return response
    }
    if(!flow || flow.state!==url.searchParams.get('state') || !url.searchParams.get('code')) return fail(flow?.state===url.searchParams.get('state') && url.searchParams.has('error')?'login_cancelled':'login_expired')
    const auth=await fetch('https://api.workos.com/user_management/authenticate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:env.WORKOS_CLIENT_ID,grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:flow.verifier}),signal:AbortSignal.timeout(10000)})
    if(!auth.ok) return fail(auth.status===429?'rate_limited':auth.status>=500?'unavailable':'error')
    const {user,access_token:accessToken,refresh_token:refreshToken}=await auth.json()
    if(!user?.id || !user.email_verified || typeof user.email!=='string') return fail('verify')
    const email=user.email.trim().toLowerCase()
    const existing=await env.DB.prepare('SELECT * FROM users WHERE id=? OR email=?').bind(user.id,email).first()
    if(existing && existing.id!==user.id) return fail('review')
    if(existing && await reconcileVerifiedEmail(env,existing,email)==='conflict') return fail('review')
    const isOwner=isDashboardOwner({id:user.id,email},env)
    let invited=false
    if(flow.invitationToken) {
      try { invited=await redeemInvitation(env,flow.invitationToken,user) } catch { return fail('error') }
      if(!invited && existing?.status==='denied') return fail('invite_denied')
      if(!invited && await invitationForOtherAccount(env,flow.invitationToken,user).catch(()=>false)) return fail('invite_account')
      invitationToken=null
      if(!invited) return fail('invite_invalid')
    }
    if(!existing && !invited) {
      const name=[user.first_name,user.last_name].filter(Boolean).join(' ')||email
      await env.DB.prepare('INSERT INTO users(id,email,name,verified,status,created_at) VALUES(?,?,?,1,?,?)').bind(user.id,email,name,isOwner?'approved':'pending',new Date().toISOString()).run()
      if(!isOwner) auditAccessRequested(env,{id:user.id,name,email},request,promise=>ctx?.waitUntil?.(promise))
      if(!isOwner) ctx?.waitUntil(Promise.allSettled([flushApprovalEvents(env).catch(error=>console.error('Approval event flush failed',error?.message)),flushGrokNotifications(env)]))
      if(!isOwner) ctx?.waitUntil(accessChanged(env).catch(()=>{}))
    }
    const sid=random()
    await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(sid,user.id,now()+SESSION_IDLE).run()
    if((env.WORKOS_RBAC_ENABLED==='true' && rbacConfigured(env)) || workosSessionConfigured(env)) {
      // Migration or provider failures do not prevent ordinary sign-in; they
      // leave privileged operations unavailable until a fresh valid session.
      let stored=false
      try { stored=await storeWorkosSession(env,sid,user.id,accessToken,refreshToken) } catch {}
      if(env.WORKOS_WIDGETS_ENABLED==='true' && !stored) {
        await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run()
        return fail('error')
      }
      if(rbacConfigured(env) && ctx?.waitUntil) ctx.waitUntil(syncWorkosMember(env,user.id).catch(()=>{}))
    } else if(env.WORKOS_WIDGETS_ENABLED==='true') {
      await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run()
      return fail('error')
    }
    const headers=new Headers({location:'/overview','cache-control':'private, no-store'})
    headers.append('set-cookie',clear)
    headers.append('set-cookie',cookie('__Host-egm_invite','',0))
    headers.append('set-cookie',cookie('__Host-egm_session',await seal({sid,profilePictureUrl:profilePhoto(user.profile_picture_url)},sessionSecrets(env),'session',SESSION_MAX),SESSION_MAX))
    ctx?.waitUntil?.(capturePosthogEvent(env,{distinct_id:user.id,event:'dashboard_signed_in',properties:{$geoip_disable:true}}))
    return new Response(null,{status:302,headers})
  }
  const user=await identity(request,env)
  if(user?.sessionUnavailable) {
    return navigation(request,url)?renderAccessPage('session_unavailable'):json({error:'session_verification_unavailable'},503)
  }
  if(user?.identityConflict) return url.pathname.startsWith('/api/')?json({error:'identity_review_required'},403):renderAccessPage('review')
  if(!user) {
    const appPath=url.pathname==='/' || pagePaths.includes(url.pathname.slice(1))
    if(request.method==='GET' && !appPath && !/^\/(api|_data)\//.test(url.pathname) && !/\.[a-z0-9]+$/i.test(url.pathname)) return renderAccessPage('not_found')
    if(request.method==='GET' && url.pathname.startsWith('/_data/') && request.headers.get('accept')?.includes('text/html')) return renderAccessPage('signin')
    if(!appPath || request.method!=='GET') return json({error:'sign_in_required'},401)
    // A valid session cookie with no live session means it ended elsewhere (sign-out, revoked).
    return renderAccessPage(await open(cookieValue(request,'__Host-egm_session'),sessionSecrets(env),'session')?'session_expired':'signin')
  }
  if(user.status!=='approved') return renderAccessPage(user.status==='pending'?'pending':'denied')
  if(url.pathname==='/api/feedback') {
    if(request.method==='GET') return loadFeedbackSurvey(env)
    const response=await submitFeedback(request,env,user)
    if(response.ok) ctx?.waitUntil(Promise.allSettled([flushFeedbackEvents(env),flushFeedbackToPosthog(env),flushGrokNotifications(env)]))
    return response
  }
  if(url.pathname==='/api/feedback/activity') {
    const response=await recordFeedbackActivity(request,env,user)
    if(response.ok) ctx?.waitUntil(flushFeedbackToPosthog(env))
    return response
  }
  if(url.pathname==='/api/access-live') {
    if(request.method!=='GET' || request.headers.get('upgrade')?.toLowerCase()!=='websocket' || request.headers.get('origin')!==env.APP_URL) return json({error:'invalid_request'},400)
    const liveDenied=ownerGate(await accessDecision(user,env))
    if(liveDenied) return liveDenied
    const live=accessLive(env)
    return live?live.fetch(request):json({error:'unavailable'},503)
  }
  if(url.pathname==='/api/access-pending') {
    if(request.method!=='GET') return json({error:'method_not_allowed'},405)
    const pendingDenied=ownerGate(await accessDecision(user,env))
    if(pendingDenied) return pendingDenied
    const row=await env.DB.prepare("SELECT EXISTS(SELECT 1 FROM users WHERE status='pending' AND verified=1) AS pending").first()
    return json({pending:row?.pending===1})
  }
  if(url.pathname==='/api/workos-widget-token') return issueUserSessionsWidgetToken(request,env,user,user.workosAccessToken)
  if(url.pathname==='/api/site-icon') return cachedSiteIcon(request,env)
  if(url.pathname==='/api/ask') return handleAsk(request,env,user,{waitUntil:promise=>ctx?.waitUntil?.(promise)})
  if(url.pathname==='/api/access' || url.pathname==='/api/invitations' || url.pathname==='/api/invitations/revoke') {
    if(request.method==='POST' && request.headers.get('origin')!==env.APP_URL) return json({error:'invalid_origin'},403)
    const accessDenied=ownerGate(await accessDecision(user,env))
    if(accessDenied) return accessDenied
    user.canManageAccess=true
    const response=await (url.pathname==='/api/access'?manageAccess(request,env,user,fetch,ctx):manageInvitations(request,env,user))
    if(url.pathname==='/api/access' && request.method==='POST' && response.ok) ctx?.waitUntil(accessChanged(env).catch(()=>{}))
    return response
  }
  if(url.pathname==='/api/refresh' && request.method==='POST') {
    if(request.headers.get('origin')!==env.APP_URL) return json({error:'owner_required'},403)
    const refreshDenied=ownerGate(await accessDecision(user,env))
    if(refreshDenied) return refreshDenied
    return json(await runRefresh(env))
  }
  if(url.pathname==='/api/growth-update-email' && request.method==='POST') {
    if(request.headers.get('origin')!==env.APP_URL) return json({error:'owner_required'},403)
    const emailDenied=ownerGate(await accessDecision(user,env))
    if(emailDenied) return emailDenied
    return json(await sendGrowthUpdateEmail(env,{force:true,idempotencySuffix:String(Date.now())}))
  }
  if(url.pathname==='/api/presentation') {
    if(request.method==='PUT' && request.headers.get('origin')!==env.APP_URL) return json({error:'invalid_origin'},403)
    const canManageAccess=(await accessDecision(user,env))==='allowed'
    const canEdit=canManageAccess
    const read=async()=>{
      const record=await env.DB.prepare('SELECT body,revision FROM presentation WHERE id=1').first()
      const widgetsEnabled=workosSessionConfigured(env)
      return {presentation:JSON.parse(record.body),revision:record.revision,canEdit,canManageAccess,widgetsEnabled,profileEnabled:widgetsEnabled,viewer:{id:user.id,name:user.name??'',email:user.email,profilePictureUrl:user.profilePictureUrl}}
    }
    if(request.method==='GET') return json(await read())
    if(request.method!=='PUT') return json({error:'method_not_allowed'},405)
    if(!canEdit) return json({error:'owner_required'},403)
    if(!request.headers.get('content-type')?.startsWith('application/json')) return json({error:'json_required'},415)
    const text=await readBody(request,130000)
    if(text===null) return json({error:'too_large'},413)
    let input,presentation
    try {
      input=JSON.parse(text)
      if(!Number.isSafeInteger(input.revision) || input.revision<0) throw Error()
      presentation=validatePresentation(input.presentation)
      if(presentation.verification) throw Error()
    } catch {return json({error:'invalid_presentation'},400)}
    const result=await env.DB.prepare('UPDATE presentation SET body=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(presentation),input.revision).run()
    return json(await read(),result.meta.changes?200:409)
  }
  if(url.pathname==='/api/snapshot-version' && request.method==='GET') {
    const current=await env.DB.prepare('SELECT generated_at FROM snapshots WHERE id=1').first()
    return json({version:current?.generated_at??seed.generatedAt})
  }
  if(url.pathname==='/api/snapshot' && request.method==='GET') {
    const current=await env.DB.prepare("SELECT json_remove(body,'$.githubHistory') AS body,generated_at FROM snapshots WHERE id=1").first()
    if(current) {
      let body=current.body
      try {
        const parsed=JSON.parse(body)
        if(parsed && typeof parsed==='object' && parsed.queries && typeof parsed.queries==='object') {
          let merged=false
          if(seed?.queries) {
            for(const [key,value] of Object.entries(seed.queries)) {
              if(!parsed.queries[key]) {
                parsed.queries[key]=value
                merged=true
              } else if(key==='weekly_brief' || key==='workflow_research') {
                const seedAt=Date.parse(value?.source?.executedAt)
                const parsedAt=Date.parse(parsed.queries[key]?.source?.executedAt)
                if(Number.isFinite(seedAt) && Number.isFinite(parsedAt) && seedAt>parsedAt) {
                  parsed.queries[key]=value
                  merged=true
                }
              }
            }
            if(parsed.queries.star_history?.rows && seed.queries.star_history?.rows && parsed.queries.star_history.rows.length<seed.queries.star_history.rows.length) {
              const byDate=new Map(seed.queries.star_history.rows.map(row=>[row.date,row]))
              for(const row of parsed.queries.star_history.rows) if(row?.date && !byDate.has(row.date)) byDate.set(row.date,row)
              parsed.queries.star_history={
                ...parsed.queries.star_history,
                rows:[...byDate.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))),
                source:{
                  ...parsed.queries.star_history.source,
                  executedAt:seed.queries.star_history.source.executedAt,
                  coverage:seed.queries.star_history.source.coverage
                }
              }
              merged=true
            }
          }
          if(merged) body=JSON.stringify(parsed)
        }
      } catch {}
      return new Response(body,{headers:{'content-type':'application/json','cache-control':'private, no-store','x-egm-snapshot-version':current.generated_at}})
    }
    return json(seed)
  }
  if(request.method!=='GET' && request.method!=='HEAD') return new Response('Method not allowed',{status:405})
  if(url.pathname.startsWith('/api/')) return json({error:'not_found'},404)
  if(!/\.[a-z0-9]+$/i.test(url.pathname) && url.pathname!=='/' && !pagePaths.includes(url.pathname.slice(1)) && !url.pathname.startsWith('/_data/')) return renderAccessPage('not_found')
  const assetUrl=new URL(request.url)
  if(!/\.[a-z0-9]+$/i.test(url.pathname)) assetUrl.pathname='/index.html'
  const asset=await env.ASSETS.fetch(new Request(assetUrl,{method:request.method}))
  const headers=new Headers(asset.headers)
  const extension=hashedAsset.exec(url.pathname)?.[1]
  const cacheable=asset.ok&&extension&&assetTypes[extension].includes(headers.get('content-type')?.split(';')[0].trim())
  headers.set('cache-control',cacheable?'private, max-age=31536000, immutable':'private, no-store')
  headers.set('x-content-type-options','nosniff')
  headers.set('x-frame-options','DENY')
  headers.set('referrer-policy','same-origin')
  const response=new Response(asset.body,{status:asset.status,headers})
  return headers.get('content-type')?.includes('text/html')
? new HTMLRewriter().on('title',{element(element){element.setInnerContent(SITE_NAME)}}).on('head',{element(element){element.append('<meta name="data-app-snapshot-storage" content="external-v1"><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=trunk-c">'+siteMeta(env.APP_URL),{html:true})}}).transform(response)
    : response
}
export default {
  async fetch(request,env,ctx) {try {return await handle(request,env,ctx)} catch(error) {console.error('Request failed',new URL(request.url).pathname,error?.message);return unavailable(request)}},
  async scheduled(controller,env) {
    if(env.WORKOS_RBAC_ENABLED==='true' || env.WORKOS_WIDGETS_ENABLED==='true') {
      try { await env.DB.prepare('DELETE FROM workos_sessions WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.id=workos_sessions.session_id AND sessions.expires_at>?)').bind(now()).run() }
      catch { console.error('Expired WorkOS session cleanup deferred') }
      if(env.WORKOS_RBAC_ENABLED==='true') try { await syncWorkosMemberships(env) } catch { console.error('WorkOS membership reconciliation deferred') }
    }
    try {await flushApprovalEvents(env)} catch {console.error('Approval notification delivery deferred')}
    try {await sendGrowthUpdateEmail(env,{onlyMondays:true,idempotencySuffix:'weekly'})} catch {console.error('Growth update email delivery deferred')}
    try {await flushFeedbackEvents(env)} catch {console.error('Feedback notification delivery deferred')}
    try {await flushFeedbackToPosthog(env)} catch {console.error('Feedback survey delivery deferred')}
    try {await flushGrokNotifications(env)} catch {console.error('Grok notification delivery deferred')}
    try {console.log(JSON.stringify(await runRefresh(env)))}
    catch {console.error('EGM refresh failed; previous complete snapshot retained');throw Error('EGM refresh failed')}
  }
}
