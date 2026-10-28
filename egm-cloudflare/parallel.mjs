// Official contract: https://docs.parallel.ai/search/advanced-search-settings
import {canonicalMentionUrl} from './mentions.mjs'

export const parallelQueries=['"elephant goldfish model"','"elephant-goldfish-model" OR "egm.dev"']
const day=86400000
const exactProject=/elephant[\s\-–—]*goldfish|egm\.dev|google\/elephant-goldfish-model/i
const queriesFor=(...rows)=>[...new Set(rows.flatMap(row=>Array.isArray(row?.queries)?row.queries:[]).filter(value=>typeof value==='string'&&value.trim()))]
function excerpt(value) {
  if(typeof value!=='string')return null
  return value.slice(exactProject.exec(value)?.index??0).trim().split(/\s+/).filter(Boolean).slice(0,25).join(' ')||null
}
function publication(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)&&Number.isFinite(Date.parse(value))?value:null
}
function source(at,rows) {
  return {label:'Parallel · indexed EGM discovery',provider:'Parallel',executedAt:at,coverage:{startDate:at.slice(0,10),endDate:at.slice(0,10)},metricDefinitions:[{label:'Discovery lead',definition:'A canonical HTTPS URL returned by a bounded quoted EGM query with a literal project-name, domain, or repository-path match in its title, URL, or provider excerpts. Search discovery is not verified page content or audience measurement.'},{label:'Discovery queries',definition:'Per-URL queries are the unique executed strings that actually returned the URL. First seen is dashboard discovery time, not publication time.'}],caveats:['At most two fast search requests per daily batch, five results per request, and seven successful batches within the configured collection window. Failed batches are cached for 24 hours.','Provider excerpts are limited to 25 words per URL. No generated research report, full page text, images, sentiment, or audience estimates are requested.','Results can overlap other providers and include first-party or syndicated pages. Search omissions are not proof of absence.','Publication dates are supplied provider metadata. Unknown dates remain unknown. API cost is not inferred from request counts.'],links:rows.slice(0,50).map(row=>({label:row.title,url:row.url})),evidenceFlow:[{title:'Official Parallel Search API',detail:'POST https://api.parallel.ai/v1/search; mode=fast; one executed query per request; advanced_settings.max_results=5; bounded provider excerpts.'},{title:'Configured quoted queries; actual matches retained per URL',detail:parallelQueries.join('\n')}]}
}

export async function collectParallel(env,request=fetch,previousQueries={},time=Date.now()) {
  const at=new Date(time).toISOString()
  const old=previousQueries.parallel_mentions
  const prior=previousQueries.parallel_status?.rows?.[0]
  const batches=Number.isSafeInteger(prior?.successfulBatches)?prior.successfulBatches:0
  let requests=0
  const requestIds=[]
  const result=(status,reason,rows=old?.rows??[],success=false)=>({
    parallel_mentions:success?{rows,source:source(at,rows)}:old??{rows:[],source:source(at,[])},
    parallel_status:{rows:[{status,reason,attemptedAt:at,lastAttemptAt:at,lastSuccessAt:success?at:prior?.lastSuccessAt??null,nextAttemptAt:new Date(time+day).toISOString(),requests,totalRequests:(prior?.totalRequests??0)+requests,successfulBatches:batches+Number(success),lifetimeBatchLimit:7,resultCount:rows.length,requestIds}],source:{...source(at,rows),label:'Parallel · collection coverage (status checked at this time)'}}
  })
  const until=Date.parse(env.REFRESH_UNTIL)
  if(!Number.isFinite(until)||time>=until)return result('expired','collection_window_ended')
  if(batches>=7)return result('expired','lifetime_batch_limit')
  if(Date.parse(prior?.nextAttemptAt)>time)return {parallel_mentions:old??{rows:[],source:source(at,[])},parallel_status:previousQueries.parallel_status}
  if(!env.PARALLEL_API_KEY)return result(old?'stale':'unavailable','credential_unavailable')
  const rows=new Map()
  for(const row of old?.rows??[]) {
    const url=canonicalMentionUrl(row.url)
    if(url)rows.set(url,{...row,url,queries:queriesFor(rows.get(url),row)})
  }
  try {
    for(const query of parallelQueries) {
      requests++
      const response=await request('https://api.parallel.ai/v1/search',{method:'POST',redirect:'error',headers:{'x-api-key':env.PARALLEL_API_KEY,'content-type':'application/json'},body:JSON.stringify({search_queries:[query],objective:'Find publicly indexed pages explicitly discussing the Elephant-Goldfish Model software project or egm.dev. Return source evidence, not an answer or sentiment inference.',mode:'fast',advanced_settings:{max_results:5,excerpt_settings:{max_chars_per_result:1000}}}),signal:AbortSignal.timeout(20000)})
      if(!response.ok)throw Error('provider_http_'+response.status)
      const payload=await response.json()
      if(!payload||!Array.isArray(payload.results)||payload.results.length>5||payload.results.some(item=>!item||typeof item.url!=='string'||typeof item.title!=='string'||item.excerpts!=null&&(!Array.isArray(item.excerpts)||item.excerpts.some(value=>typeof value!=='string'))))throw Error('invalid_provider_response')
      const requestId=payload.search_id??payload.id
      if(typeof requestId==='string')requestIds.push(requestId.slice(0,200))
      for(const item of payload.results) {
        const body=Array.isArray(item.excerpts)?item.excerpts.join(' '):typeof item.snippet==='string'?item.snippet:''
        const url=canonicalMentionUrl(item.url)
        if(!url||!exactProject.test(item.title+' '+url+' '+body))continue
        const found=rows.get(url)
        rows.set(url,{url,title:item.title.slice(0,350),domain:new URL(url).hostname.replace(/^www\./,''),published:publication(item.publish_date??item.published_date)??found?.published??null,firstSeen:found?.firstSeen??at,lastSeen:at,queries:queriesFor(found,{queries:[query]}),excerpt:excerpt(body)??found?.excerpt??null,provider:'Parallel',discovery:'Indexed title, URL or excerpt match'})
      }
    }
    return result('available',null,[...rows.values()].sort((a,b)=>b.firstSeen.localeCompare(a.firstSeen)||a.title.localeCompare(b.title)).slice(0,200),true)
  } catch(error) {
    const reason=/^provider_http_\d{3}$/.test(error.message)||error.message==='invalid_provider_response'?error.message:'collection_failed'
    return result(old?'stale':'unavailable',reason)
  }
}
