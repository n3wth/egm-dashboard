const lifetime=604800
export const defaultSiteHosts=['google.com','youtube.com','linkedin.com','github.com','microsoft.com','threads.com','bing.com','duckduckgo.com','egm.dev','exa.ai','tavily.com','parallel.ai','firecrawl.dev','semrush.com']
export function validSiteHost(value) {
  if(typeof value!=='string'||value.length>253||value!==value.trim())return null
  const host=value.toLowerCase()
  if(!host.includes('.')||!host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))||/^\d+(?:\.\d+){3}$/.test(host)||/^[\d.]+$/.test(host)||/(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)$/.test(host))return null
  return host
}
export function snapshotSiteHosts(snapshot) {
  const hosts=new Set()
  let inspected=0
  function visit(value) {
    if(!value||typeof value!=='object'||inspected++>20000)return
    for(const [key,item] of Object.entries(value)) {
      if(['url','sourceURL','readmeUrl'].includes(key)&&typeof item==='string') {
        try {const url=new URL(item),host=validSiteHost(url.hostname);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&host)hosts.add(host)}catch{}
      } else if(key==='domain'&&validSiteHost(item))hosts.add(validSiteHost(item))
      else if(typeof item==='object')visit(item)
    }
  }
  visit(snapshot)
  return hosts
}
async function limitedImage(response) {
  const contentType=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if(!response.ok||!['image/png','image/x-icon','image/vnd.microsoft.icon'].includes(contentType))throw Error('invalid_icon')
  if(Number(response.headers.get('content-length'))>32768)throw Error('icon_too_large')
  const reader=response.body?.getReader()
  if(!reader)throw Error('missing_icon')
  const chunks=[]
  let length=0
  try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>32768)throw Error('icon_too_large');chunks.push(value)}}finally{await reader.cancel()}
  if(!length)throw Error('empty_icon')
  const bytes=new Uint8Array(length)
  let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)
  const ico=bytes.length>=6&&bytes[0]===0&&bytes[1]===0&&bytes[2]===1&&bytes[3]===0
  if(contentType==='image/png'?!png:!ico)throw Error('invalid_image_bytes')
  return new Response(bytes,{headers:{'content-type':contentType,'cache-control':`public, max-age=${lifetime}`,'x-content-type-options':'nosniff'}})
}
/** Call only after the Worker has authenticated an approved dashboard user. */
export async function cachedSiteIcon(request,env,options={}) {
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405})
  const url=new URL(request.url)
  const host=validSiteHost(url.searchParams.get('host'))
  if(!host||url.searchParams.getAll('host').length!==1)return new Response(null,{status:400,headers:{'cache-control':'no-store'}})
  const allowed=new Set([...defaultSiteHosts,...String(env.FAVICON_HOSTS??'').split(',').map(value=>validSiteHost(value.trim())).filter(Boolean)])
  if(!allowed.has(host)) {
    let snapshot=options.snapshot
    if(!snapshot){try{const stored=await env.DB.prepare('SELECT body FROM snapshots WHERE id=1').first();snapshot=stored?JSON.parse(stored.body):null}catch{}}
    if(!snapshotSiteHosts(snapshot).has(host))return new Response(null,{status:404,headers:{'cache-control':'no-store'}})
  }
  const cache=options.cache??globalThis.caches?.default
  const key=new Request(url.origin+'/api/site-icon?v=3&host='+encodeURIComponent(host),{method:'GET'})
  let result=cache?await cache.match(key):null
  if(!result) {
    try {
      const upstream=new URL('https://favicon.vemetric.com/'+encodeURIComponent(host))
      upstream.searchParams.set('size','32')
      upstream.searchParams.set('format','png')
      const response=await (options.request??fetch)(upstream.href,{redirect:'error',signal:AbortSignal.timeout(5000)})
      result=await limitedImage(response)
    }catch {result=new Response(null,{status:204,headers:{'cache-control':`public, max-age=${lifetime}`}})}
    if(cache)await cache.put(key,result.clone())
  }
  const headers=new Headers(result.headers)
  headers.set('cache-control',`private, max-age=${lifetime}`)
  headers.set('x-content-type-options','nosniff')
  headers.set('vary','Cookie')
  return new Response(request.method==='HEAD'?null:result.body,{status:result.status,headers})
}
