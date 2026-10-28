export const mentionQueries = [
  '"elephant goldfish model" OR "elephant-goldfish-model" OR "egm.dev"',
  '("elephant goldfish model" OR "elephant-goldfish-model" OR "egm.dev") site:youtube.com',
  '("elephant goldfish model" OR "elephant-goldfish-model" OR "egm.dev") (site:linkedin.com OR site:reddit.com OR site:x.com OR site:news.ycombinator.com)'
]
export const mentionsCacheMs = 2*60*60*1000
const socialHosts = new Map([['linkedin.com','LinkedIn'],['reddit.com','Reddit'],['x.com','X'],['twitter.com','X'],['threads.net','Threads'],['threads.com','Threads'],['news.ycombinator.com','Hacker News'],['bsky.app','Bluesky']])
const exactMention = /elephant[\s\-–—]*goldfish|egm\.dev|google\/elephant-goldfish-model/i
export function canonicalMentionUrl(value) {
  try {
    const url=new URL(value)
    if(url.protocol!=='https:' || url.username || url.password || value.length>2048) return null
    url.hostname=url.hostname.toLowerCase().replace(/^www\./,'')
    if(['m.youtube.com','youtu.be','youtube.com'].includes(url.hostname)) {
      const id=url.hostname==='youtu.be'?url.pathname.split('/')[1]:url.searchParams.get('v')??url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]
      if(!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null
      return 'https://www.youtube.com/watch?v='+id
    }
    if(url.hostname==='twitter.com') url.hostname='x.com'
    url.hash=''
    for(const key of [...url.searchParams.keys()]) if(/^(utm_|fbclid$|gclid$|ref$|source$|si$)/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    url.pathname=url.pathname.replace(/\/$/,'')||'/'
    return url.href
  } catch {return null}
}
export function normalizeMentions(candidates,previous=[],at=new Date().toISOString()) {
  const lineage=(...observations)=>[...new Set(observations.flatMap(row=>[...(Array.isArray(row?.queries)?row.queries:[]),row?.query]).filter(query=>typeof query==='string'&&query.trim()))]
  const rows=new Map()
  for(const row of previous) {
    const url=canonicalMentionUrl(row.url)
    if(!url)continue
    const queries=lineage(rows.get(url),row)
    rows.set(url,{...row,url,queries,query:queries[0]??null})
  }
  for(const candidate of candidates) {
    const text=String(candidate.title??'')+' '+String(candidate.description??candidate.snippet??'')
    if(!exactMention.test(text)) continue
    const url=canonicalMentionUrl(candidate.url)
    if(!url || !candidate.title) continue
    const host=new URL(url).hostname.replace(/^www\./,'')
    // The project itself is not an external mention; official Google announcements remain labeled.
    if(host==='egm.dev' || host==='github.com') continue
    const platform=host==='youtube.com'?'YouTube':socialHosts.get(host)??host
    const kind=platform==='YouTube'?'Video':socialHosts.has(host)?'Social':host==='opensource.googleblog.com'||host==='research.google'?'Official':'Media / web'
    const old=rows.get(url)
    const date=candidate.published??candidate.publishedAt??candidate.metadata?.publishedTime??candidate.metadata?.datePublished
    const published=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date)&&Number.isFinite(Date.parse(date))?date:null
    // Only the query attached to this actual search result is new lineage.
    // Never assign every configured query to a URL that just one query found.
    const queries=lineage(old,{query:candidate.query})
    rows.set(url,{url,title:String(candidate.title).replace(/ - YouTube$| - LinkedIn$| - Reddit$/,'').slice(0,350),platform,kind,published:published??old?.published??null,firstSeen:old?.firstSeen??at,lastSeen:at,discovery:'Indexed title or excerpt match',queries,query:queries[0]??null})
  }
  return [...rows.values()].sort((a,b)=>b.firstSeen.localeCompare(a.firstSeen)||a.title.localeCompare(b.title)).slice(0,200)
}
function evidenceSource(at) {
  return {label:'Firecrawl Search · public EGM mentions',provider:'Firecrawl',executedAt:at,coverage:{startDate:at.slice(0,10),endDate:at.slice(0,10)},metricDefinitions:[{label:'Mention',definition:'A distinct canonical external URL whose indexed title or excerpt contains the Elephant-Goldfish project name, egm.dev, or repository path. Search evidence is not an audited endorsement or direct engagement measurement.'},{label:'First seen',definition:'The first dashboard collection that found the URL. It is not the publication time.'},{label:'Discovery queries',definition:'Each row retains unique executed query strings that actually returned that canonical URL, across observations. The legacy query field is the first recorded query; older rows may have incomplete lineage.'}],caveats:['Public indexed results only. Private, deleted, unindexed and login-restricted posts may be absent; this is not exhaustive social listening.','Search providers may interpret site operators loosely. Query text does not prove platform membership; displayed platforms come from each result URL hostname.','No views, likes, reach, sentiment, or inferred publication dates are reported. Dates remain blank unless the provider supplies an unambiguous ISO publication date.','Up to three bounded queries with eight results each, cached for two hours. Previously discovered URLs remain in the list, up to 200.'],links:[],evidenceFlow:[{title:'Configured project discovery queries (actual matches are retained per URL)',detail:mentionQueries.join('\n')}]}
}
export function mentionsQueryRecords(rows,at,status='available',detail={}) {
  const source=evidenceSource(at)
  source.links=rows.slice(0,50).map(row=>({label:row.title,url:row.url}))
  return {mentions:{rows,source},mentions_status:{rows:[{status,lastAttemptAt:at,lastSuccessAt:status==='available'?at:null,cacheHours:2,queries:mentionQueries.length,...detail}],source:{...source,label:'Public mentions · collection coverage'}}}
}
export async function collectMentions(env,request=fetch,previousQueries=null,time=Date.now()) {
  if(!previousQueries) {
    const saved=await env.DB.prepare('SELECT body FROM snapshots WHERE id=1').first()
    try {previousQueries=saved?JSON.parse(saved.body).queries:{}} catch {previousQueries={}}
  }
  const at=new Date(time).toISOString()
  const prior=previousQueries.mentions??null
  const previousStatus=previousQueries.mentions_status?.rows?.[0]
  const lastSuccess=previousStatus?.lastSuccessAt??prior?.source?.executedAt
  const lastAttempt=previousStatus?.lastAttemptAt??lastSuccess
  // Failures are also cached to prevent draining units while a provider is unavailable.
  if(lastAttempt&&time-Date.parse(lastAttempt)<mentionsCacheMs) return {mentions:prior??{rows:[],source:evidenceSource(at)},mentions_status:previousQueries.mentions_status??mentionsQueryRecords([],at,'unavailable').mentions_status}
  const failure=reason=>{
    const rows=prior?.rows??[]
    const records=mentionsQueryRecords(rows,at,rows.length?'stale':'unavailable',{reason,lastSuccessAt:lastSuccess??null})
    if(prior) records.mentions=prior
    return records
  }
  if(!env.FIRECRAWL_API_KEY) return failure('credential_unavailable')
  if(env.REFRESH_UNTIL&&time>=Date.parse(env.REFRESH_UNTIL)) return failure('collection_window_ended')
  try {
    const candidates=[]
    let creditsUsed=0,usageReturned=false
    for(const query of mentionQueries) {
      const response=await request('https://api.firecrawl.dev/v2/search',{method:'POST',headers:{authorization:'Bearer '+env.FIRECRAWL_API_KEY,'content-type':'application/json'},body:JSON.stringify({query,limit:8,sources:['web'],timeout:20000}),signal:AbortSignal.timeout(25000)})
      if(!response.ok) return failure('provider_http_'+response.status)
      const result=await response.json()
      if(result.success!==true || !Array.isArray(result.data?.web)) return failure('invalid_provider_response')
      for(const row of result.data.web)candidates.push({...row,query})
      if(Number.isFinite(result.creditsUsed)){creditsUsed+=result.creditsUsed;usageReturned=true}
    }
    const rows=normalizeMentions(candidates,prior?.rows??[],at)
    return mentionsQueryRecords(rows,at,'available',{lastSuccessAt:at,...(usageReturned?{creditsUsed}:{}),indexedCandidates:candidates.length})
  } catch {return failure('provider_collection_failed')}
}
