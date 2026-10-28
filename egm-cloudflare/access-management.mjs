const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}})

export async function manageAccess(request,env,user) {
  if(!user||user.status!=='approved'||user.verified!==1||user.email!==env.OWNER_EMAIL)return reply({error:'owner_required'},403)
  if(request.method==='GET') {
    const result=await env.DB.prepare('SELECT id,name,email,status,created_at,decided_at FROM users ORDER BY created_at DESC LIMIT 200').all()
    return reply({users:result.results,shareUrl:env.APP_URL+'/overview',ownerId:user.id})
  }
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405)
  if(request.headers.get('origin')!==env.APP_URL)return reply({error:'invalid_origin'},403)
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'json_required'},415)
  const body=await request.text()
  if(body.length>2048)return reply({error:'too_large'},413)
  let input
  try{input=JSON.parse(body)}catch{return reply({error:'invalid_request'},400)}
  if(!input||Object.keys(input).some(key=>!['id','decision'].includes(key))||typeof input.id!=='string'||!input.id||input.id.length>200||!['approved','denied'].includes(input.decision)||input.id===user.id)return reply({error:'invalid_request'},400)
  const at=new Date().toISOString()
  const results=await env.DB.batch([
    env.DB.prepare("UPDATE users SET status=?,decided_at=?,decided_by=? WHERE id=? AND status='pending' AND email<>?").bind(input.decision,at,user.id,input.id,env.OWNER_EMAIL),
    env.DB.prepare('INSERT INTO audit(id,user_id,action,actor,created_at) SELECT ?,id,?,?,? FROM users WHERE changes()=1 AND id=? AND decided_at=? AND decided_by=? AND status=?').bind(crypto.randomUUID(),input.decision,user.id,at,input.id,at,user.id,input.decision)
  ])
  return results[0].meta?.changes===1?reply({ok:true}):reply({error:'not_pending'},409)
}
