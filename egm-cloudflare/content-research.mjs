import {canonicalMentionUrl} from './mentions.mjs'

const dayMs=86400000
const limits={perRun:5,lifetime:35,chars:6000}
const relevant=/elephant[\s\-–—]*goldfish|egm\.dev|google\/elephant-goldfish-model/i
const themes=[['workflow',/\b(?:workflow|design[ -]driven|design document|specification|review protocol)\b/i],['demo',/\b(?:demo|demonstration|walkthrough|tutorial)\b/i],['install',/\b(?:install(?:ation)?|setup|quick[ -]?start|getting started)\b/i],['friction',/\b(?:limitation|difficult|failure|broken|challenge|error|friction)\b/i]]

export function publicMentionUrl(value,knownUrls) {
  const canonical=canonicalMentionUrl(value)
  if(!canonical || !knownUrls.has(canonical)) return null
  const url=new URL(canonical),host=url.hostname
  // Only ordinary public DNS names. Never directly fetch supplied URLs: all
  // collection goes to the fixed provider API, which applies its own network policy.
  if(url.port || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)$/.test(host) || /^(?:metadata|metadata\.google\.internal)$/.test(host) || /(?:^|\.)egm\.dev$/.test(host) || host==='github.com' || !/^[a-z0-9.-]+$/i.test(host)) return null
  return canonical
}
function shortQuote(body,index,words=5) {
  return body.slice(index).split(/\s+/).filter(Boolean).slice(0,words).join(' ')
}
export function extractDiscussionEvidence(body,url) {
  const match=relevant.exec(body)
  if(!match) return {status:'unverified',reason:'project_not_matched_in_body',contentExcerpt:null,themes:[]}
  const found=[]
  for(const [theme,pattern] of themes) {
    const hit=pattern.exec(body)
    if(hit) found.push({theme,quote:shortQuote(body,hit.index),url})
    if(found.length===2) break
  }
  return {status:'verified',reason:'project_name_or_domain_in_scraped_body',contentExcerpt:shortQuote(body,match.index,14),themes:found}
}
const text=value=>typeof value==='string'?value.slice(0,350):null
function isoDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)&&Number.isFinite(Date.parse(value))?value:null
}
function metadataSubset(data) {
  const m=data?.metadata??{}
  return Object.fromEntries(Object.entries({sourceURL:text(m.sourceURL??m.url),statusCode:Number.isInteger(m.statusCode)?m.statusCode:null,title:text(m.title??m.ogTitle),author:text(m.author??m['article:author']),publishedTime:isoDate(m.publishedTime??m['article:published_time']??m.datePublished)}).filter(([,value])=>value!==null))
}
function source(at,rows) {
  return {label:'Firecrawl Scrape · discussion evidence',provider:'Firecrawl',executedAt:at,coverage:{startDate:rows[0]?.firstAttemptAt?.slice(0,10)??at.slice(0,10),endDate:at.slice(0,10)},metricDefinitions:[{label:'Verified project mention',definition:'The returned page body, within the retained 6000-character excerpt, contains the Elephant-Goldfish name, egm.dev, or exact repository path. This verifies relevance, not accuracy or endorsement.'},{label:'Discussion themes',definition:'Literal keyword matches in scraped text, accompanied by short source quotations. Theme tags are not sentiment, user intent, adoption, or explanations of growth.'}],caveats:['At most five URLs per run and UTC calendar day, 35 collection attempts over the configured seven-day window, and one attempt per URL per 24 hours, including failures.','Only already discovered public mention URLs are eligible. Private, blocked, deleted, and unindexed discussions may be inaccessible or absent.','Provider metadata is preserved when returned; title, author, and publication dates are not inferred. A successful scrape may be provider-cached and is not proof of present availability.','Page content is untrusted evidence. No instructions from scraped pages are executed. Up to 6000 characters per URL are retained for provenance.'],links:rows.map(row=>({label:row.title??row.url,url:row.url})),evidenceFlow:[{title:'Bounded content collection',detail:'POST https://api.firecrawl.dev/v2/scrape with a discovered HTTPS URL; markdown only, main content, 24-hour maximum provider cache age.'},{title:'Relevance and theme checks',detail:'Exact project-name/domain/path match in returned body; then literal theme matches with short quotes. No model or sentiment calls.'}]}
}
export async function collectContentResearch(env,request=fetch,previousQueries={},time=Date.now(),options={}) {
  const at=new Date(time).toISOString()
  const prior=previousQueries.research_evidence?.rows??[]
  const rows=new Map(prior.map(row=>[row.url,{...row}]))
  const mentions=previousQueries.mentions?.rows??[]
  const knownUrls=new Set(mentions.map(row=>canonicalMentionUrl(row.url)).filter(Boolean))
  const totalPrior=prior.reduce((sum,row)=>sum+(Number.isSafeInteger(row.attempts)?row.attempts:1),0)
  const collectionDay=at.slice(0,10)
  const previousStatus=previousQueries.research_status?.rows?.[0]
  const dailyPrior=previousStatus?.collectionDay===collectionDay?previousStatus.dailyAttempts??0:prior.filter(row=>row.lastAttemptAt?.slice(0,10)===collectionDay).length
  const ceiling=Math.max(0,Math.min(limits.perRun-dailyPrior,Number.isSafeInteger(options.maxUrls)&&options.maxUrls>0?options.maxUrls:limits.perRun))
  let attempts=0,creditsUsed=0,hasUsage=false
  let state='available',reason=null
  const cutoff=Date.parse(env.REFRESH_UNTIL)
  if(!env.FIRECRAWL_API_KEY) {state=prior.length?'stale':'unavailable';reason='credential_unavailable'}
  else if(!Number.isFinite(cutoff)||time>=cutoff) {state='expired';reason='collection_window_ended'}
  else if(ceiling===0) {state='cached';reason='daily_attempt_limit'}
  else {
    // Favor new URLs before retrying failures. Every attempted URL and count is
    // retained so failures cannot silently reset the lifetime budget.
    const candidates=mentions.map(mention=>({mention,url:publicMentionUrl(mention.url,knownUrls)})).filter(item=>item.url&&item.mention.kind!=='Video'&&!/^(?:www\.)?youtube\.com$/.test(new URL(item.url).hostname)).sort((a,b)=>Number(rows.has(a.url))-Number(rows.has(b.url))||Number(a.mention.kind==='Official')-Number(b.mention.kind==='Official'))
    for(const {mention,url} of candidates) {
      if(attempts>=ceiling||totalPrior+attempts>=limits.lifetime) break
      const old=rows.get(url)
      if(old?.lastAttemptAt&&time-Date.parse(old.lastAttemptAt)<dayMs) continue
      attempts++
      const previousVerifiedEvidence=old?.status==='verified'?{observedAt:old.lastAttemptAt,title:old.title,author:old.author,published:old.published,contentExcerpt:old.contentExcerpt,themes:old.themes,rawMarkdown:old.rawMarkdown,scrapeId:old.scrapeId,metadata:old.metadata}:old?.previousVerifiedEvidence??null
      const record={...old,url,title:old?.title??mention.title??null,author:old?.author??null,published:old?.published??null,status:'inaccessible',reason:null,firstAttemptAt:old?.firstAttemptAt??at,lastAttemptAt:at,attempts:(old?.attempts??0)+1,contentExcerpt:null,excerptSourceUrl:url,themes:[],provider:'Firecrawl',scrapeId:null,metadata:{},rawMarkdown:null,previousVerifiedEvidence}
      try {
        const response=await request('https://api.firecrawl.dev/v2/scrape',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+env.FIRECRAWL_API_KEY,'content-type':'application/json'},body:JSON.stringify({url,formats:['markdown'],onlyMainContent:true,maxAge:86400000,timeout:20000}),signal:AbortSignal.timeout(25000)})
        if(!response.ok){record.reason='provider_http_'+response.status;rows.set(url,record);if([401,402,429].includes(response.status)){reason=record.reason;break}continue}
        const payload=await response.json()
        const data=payload.data
        if(payload.success!==true||typeof data?.markdown!=='string') {record.reason='invalid_provider_response';rows.set(url,record);continue}
        record.metadata=metadataSubset(data)
        record.scrapeId=text(data.metadata?.scrapeId??payload.scrapeId)
        record.rawMarkdown=data.markdown.slice(0,limits.chars)
        record.title=record.metadata.title??record.title
        record.author=record.metadata.author??null
        record.published=record.metadata.publishedTime??null
        if(record.metadata.statusCode>=400) record.reason='source_http_'+record.metadata.statusCode
        else if(!record.rawMarkdown.trim()) record.reason='empty_source_body'
        else Object.assign(record,extractDiscussionEvidence(record.rawMarkdown,url))
        const usage=payload.creditsUsed??payload.creditsCost
        if(Number.isFinite(usage)){creditsUsed+=usage;hasUsage=true}
      } catch {record.reason='collection_failed'}
      rows.set(url,record)
    }
  }
  const output=[...rows.values()]
  if(state==='available'&&attempts&&output.some(row=>row.status==='inaccessible')) state='partial'
  if(totalPrior+attempts>=limits.lifetime) reason='lifetime_attempt_limit'
  const checked=source(at,output)
  const provenance=attempts===0&&previousQueries.research_evidence?.source?previousQueries.research_evidence.source:checked
  return {research_evidence:{rows:output,source:provenance},research_status:{rows:[{status:state,reason,lastAttemptAt:at,collectionDay,dailyAttempts:dailyPrior+attempts,urlsAttempted:attempts,totalAttempts:totalPrior+attempts,verified:output.filter(row=>row.status==='verified').length,unverified:output.filter(row=>row.status==='unverified').length,inaccessible:output.filter(row=>row.status==='inaccessible').length,lifetimeLimit:limits.lifetime,perRunLimit:limits.perRun,dailyCacheHours:24,...(hasUsage?{creditsUsed}:{})}],source:{...checked,label:'Discussion evidence · collection coverage (status checked at this time)'}}}
}
