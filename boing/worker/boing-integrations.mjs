// These helpers do not authorize a caller or persist data. The caller must load
// the project and installation from an authorized workspace-scoped record.
const API = 'https://api.github.com'
const DEFAULT_TIMEOUT = 10000
const headers = {accept:'application/vnd.github+json','user-agent':'boing-growth','x-github-api-version':'2022-11-28'}

function integer(value,name) {
  if(!Number.isSafeInteger(value) || value<1) throw new Error(`Invalid ${name}`)
  return value
}

function repoPart(value,name) {
  if(typeof value!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) || value==='.' || value==='..') throw new Error(`Invalid ${name}`)
  return value
}

function base64url(bytes) {
  let binary=''
  for(const byte of bytes) binary+=String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}

function encode(value) { return base64url(new TextEncoder().encode(JSON.stringify(value))) }

async function appJwt(appId,privateKey,now=Date.now()) {
  if(typeof appId!=='string' && typeof appId!=='number') throw new Error('Invalid GitHub App ID')
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(appId))) throw new Error('Invalid GitHub App ID')
  if(typeof privateKey!=='string' || !privateKey.includes('BEGIN PRIVATE KEY')) throw new Error('GitHub App private key unavailable')
  const der=atob(privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,''))
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(der,c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign'])
  const iat=Math.floor(now/1000)-60
  const token=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat,exp:iat+540,iss:String(appId)})
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(token))
  return token+'.'+base64url(new Uint8Array(signature))
}

async function json(request,url,options={}) {
  const response=await request(url,{...options,redirect:'manual',signal:AbortSignal.timeout(DEFAULT_TIMEOUT)})
  if(!response.ok) throw new Error(`Provider request failed (${response.status})`)
  return response.json()
}

// Accept only DNS names intended for the public web. Do not fetch this URL
// directly: DNS rebinding and redirects can make a hostname resolve privately.
export function publicWebsiteUrl(value) {
  if(typeof value!=='string' || value.length>2048) throw new Error('Invalid website URL')
  let url
  try { url=new URL(value) } catch { throw new Error('Invalid website URL') }
  // PageSpeed receives the complete target URL. Query strings can contain
  // secrets, so reject them before storing or calling the provider.
  if(url.href.split('#',1)[0].includes('?')) throw new Error('Website URL must not include a query string')
  const host=url.hostname.toLowerCase().replace(/\.$/,'')
  if(!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port || !host.includes('.') || host.length>253 || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host) || !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Website must be a public HTTP(S) hostname')
  url.hash=''
  return url.href
}

// Request an installation token for exactly one selected repository. GitHub
// itself rejects repos outside the installation's grants. Never log the token.
export async function createRepositoryToken({installationId,repositoryId,appId,privateKey,includeTraffic=false},request=fetch) {
  integer(installationId,'installation ID'); integer(repositoryId,'repository ID')
  const jwt=await appJwt(appId,privateKey)
  const permissions=includeTraffic ? {metadata:'read',administration:'read'} : {metadata:'read'}
  const result=await json(request,`${API}/app/installations/${installationId}/access_tokens`,{method:'POST',headers:{...headers,authorization:`Bearer ${jwt}`,'content-type':'application/json'},body:JSON.stringify({repository_ids:[repositoryId],permissions})})
  if(typeof result.token!=='string' || !result.token || typeof result.expires_at!=='string') throw new Error('Invalid GitHub installation token response')
  return {token:result.token,expiresAt:result.expires_at}
}

// All paths are fixed. A failed optional metric is explicitly unavailable,
// not a fabricated zero. No response or error includes credentials.
export async function collectGitHubProject({installationId,repositoryId,owner,repository,appId,privateKey,includeTraffic=false},request=fetch) {
  integer(repositoryId,'repository ID'); repoPart(owner,'repository owner'); repoPart(repository,'repository name')
  const {token}=await createRepositoryToken({installationId,repositoryId,appId,privateKey,includeTraffic},request)
  const base=`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  const get=path=>json(request,base+path,{headers:{...headers,authorization:`Bearer ${token}`}})
  const repo=await get('')
  if(repo.id!==repositoryId) throw new Error('Selected repository does not match installation record')
  const collectedAt=new Date().toISOString()
  const metrics={stars:repo.stargazers_count??null,forks:repo.forks_count??null,openIssues:repo.open_issues_count??null}
  const traffic={}
  for(const [name,path] of [['views','/traffic/views'],['clones','/traffic/clones']]) {
    try {
      if (!includeTraffic) throw new Error('Traffic permission not enabled')
      const result=await get(path)
      traffic[name]={count:Number.isFinite(result.count)?result.count:null,uniques:Number.isFinite(result.uniques)?result.uniques:null,status:'available'}
    } catch { traffic[name]={count:null,uniques:null,status:'unavailable'} }
  }
  return {source:'GitHub',repository:{id:repo.id,fullName:repo.full_name,private:Boolean(repo.private)},collectedAt,metrics,traffic}
}

// Google PageSpeed fetches the page, not this Worker. Website URLs and API
// keys must not be included in errors or persisted request logs.
export async function collectWebsitePerformance(website,apiKey,request=fetch) {
  const url=publicWebsiteUrl(website)
  if(typeof apiKey!=='string' || !apiKey) return {source:'PageSpeed Insights',status:'unavailable',reason:'not_configured',collectedAt:new Date().toISOString()}
  const endpoint=new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  endpoint.searchParams.set('url',url); endpoint.searchParams.set('strategy','mobile'); endpoint.searchParams.set('key',apiKey)
  try {
    const data=await json(request,endpoint.href)
    const score=data.lighthouseResult?.categories?.performance?.score
    if(!Number.isFinite(score) || score<0 || score>1) throw new Error('Invalid score')
    return {source:'PageSpeed Insights',status:'available',collectedAt:new Date().toISOString(),performanceScore:Math.round(score*100)}
  } catch { return {source:'PageSpeed Insights',status:'unavailable',reason:'provider_error',collectedAt:new Date().toISOString()} }
}
