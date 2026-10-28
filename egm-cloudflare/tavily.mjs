// Official contract: https://docs.tavily.com/documentation/api-reference/endpoint/search
import {canonicalMentionUrl} from './mentions.mjs'

export const tavilyQueries=['"elephant goldfish model"','"elephant-goldfish-model"','"egm.dev"']
const cacheMs=86400000
const exactProject=/elephant[\s\-–—]*goldfish|egm\.dev|google\/elephant-goldfish-model/i
const excerpt=value=>typeof value==='string'?value.slice(exactProject.exec(value)?.index??0).trim().split(/\s+/).filter(Boolean).slice(0,25).join(' '):null
const queriesFor=(...rows)=>[...new Set(rows.flatMap(row=>[...(Array.isArray(row?.queries)?row.queries:[]),row?.query]).filter(value=>typeof value==='string'&&value.trim()))]
function publicationDate(value) {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value
  // Only complete provider timestamps, including Tavily's RFC/GMT date format.
  if(!/^\d{4}-\d{2}-\d{2}T/.test(value)&&!/^\w{3}, \d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))return null
  return new Date(value).toISOString()
}
function source(at,rows) {
  return {label:'Tavily · indexed EGM discovery',provider:'Tavily',executedAt:at,coverage:{startDate:at.slice(0,10),endDate:at.slice(0,10)},metricDefinitions:[{label:'Discovery lead',definition:'A canonical URL returned by a bounded quoted EGM query, with a literal project-name, repository-path, or egm.dev match in the result title, URL, or content excerpt. This is indexed search evidence, not verified page content or measured audience reach.'},{label:'Discovery queries',definition:'Each URL retains only unique executed query strings that actually returned it, including earlier observations. First seen is the first dashboard observation, not publication time.'}],caveats:['At most three basic search requests per 24-hour collection, five results per request, and seven successful batches over the configured collection window. Failed batches are also cached for 24 hours.','Search indexing and provider query interpretation are incomplete. No generated answer, raw page text, images, sentiment, audience estimates, or deep research is requested.','Only HTTPS URLs accepted by the shared canonicalizer are retained. Excerpts are limited to 25 words per URL; publication dates are supplied metadata, never inferred.','Results are discovery leads requiring individual review. They may include first-party pages and overlap other search providers.'],links:rows.slice(0,50).map(row=>({label:row.title,url:row.url})),evidenceFlow:[{title:'Official Tavily Search API',detail:'POST https://api.tavily.com/search; search_depth=basic, max_results=5, auto_parameters=false, include_answer=false, include_raw_content=false, include_usage=true'},{title:'Configured quoted discovery queries (actual matches retained per URL)',detail:tavilyQueries.join('\n')}]}
}
export async function collectTavily(env,request=fetch,previousQueries={},time=Date.now()) {
  const at=new Date(time).toISOString()
  const prior=previousQueries.tavily_status?.rows?.[0]
  const old=previousQueries.tavily_mentions
  const completed=Number.isSafeInteger(prior?.successfulBatches)?prior.successfulBatches:0
  let requests=0,creditsUsed=0,usageReturned=false
  const result=(status,reason,rows=old?.rows??[],success=false)=>({
    tavily_mentions:success?{rows,source:source(at,rows)}:old??{rows:[],source:source(at,[])},
    tavily_status:{rows:[{status,reason,attemptedAt:at,lastAttemptAt:at,lastSuccessAt:success?at:prior?.lastSuccessAt??null,nextAttemptAt:new Date(time+cacheMs).toISOString(),requests,totalRequests:(prior?.totalRequests??0)+requests,successfulBatches:completed+Number(success),lifetimeBatchLimit:7,resultCount:rows.length,...(usageReturned?{creditsUsed}:{})}],source:{...source(at,rows),label:'Tavily · collection coverage (status checked at this time)'}}
  })
  const until=Date.parse(env.REFRESH_UNTIL)
  if(!Number.isFinite(until)||time>=until)return result('expired','collection_window_ended')
  if(completed>=7)return result('expired','lifetime_batch_limit')
  if(Date.parse(prior?.nextAttemptAt)>time)return {tavily_mentions:old??{rows:[],source:source(at,[])},tavily_status:previousQueries.tavily_status}
  if(!env.TAVILY_API_KEY)return result(old?'stale':'unavailable','credential_unavailable')
  const rows=new Map()
  for(const row of old?.rows??[]) {
    const url=canonicalMentionUrl(row.url)
    if(!url)continue
    rows.set(url,{...row,url,queries:queriesFor(rows.get(url),row)})
  }
  try {
    for(const query of tavilyQueries) {
      requests++
      const response=await request('https://api.tavily.com/search',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+env.TAVILY_API_KEY,'content-type':'application/json'},body:JSON.stringify({query,search_depth:'basic',max_results:5,topic:'general',auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,include_published_date:true,include_usage:true}),signal:AbortSignal.timeout(20000)})
      if(!response.ok)throw Error('provider_http_'+response.status)
      const payload=await response.json()
      if(!payload||!Array.isArray(payload.results)||payload.results.length>5||payload.results.some(row=>!row||typeof row!=='object'||typeof row.url!=='string'||typeof row.title!=='string'||row.content!=null&&typeof row.content!=='string'))throw Error('invalid_provider_response')
      if(Number.isFinite(payload.usage?.credits)&&payload.usage.credits>=0){creditsUsed+=payload.usage.credits;usageReturned=true}
      for(const item of payload.results) {
        const url=canonicalMentionUrl(item.url)
        if(!url||!exactProject.test(item.title+' '+item.url+' '+(item.content??'')))continue
        const found=rows.get(url)
        rows.set(url,{url,title:item.title.slice(0,350),domain:new URL(url).hostname.replace(/^www\./,''),published:publicationDate(item.published_date)??found?.published??null,firstSeen:found?.firstSeen??at,lastSeen:at,queries:queriesFor(found,{query}),excerpt:excerpt(item.content)||found?.excerpt||null,provider:'Tavily',discovery:'Indexed title, URL or excerpt match'})
      }
    }
    return result('available',null,[...rows.values()].sort((a,b)=>b.firstSeen.localeCompare(a.firstSeen)||a.title.localeCompare(b.title)).slice(0,200),true)
  } catch(error) {
    const reason=/^provider_http_\d{3}$/.test(error.message)||error.message==='invalid_provider_response'?error.message:'collection_failed'
    return result(old?'stale':'unavailable',reason)
  }
}
