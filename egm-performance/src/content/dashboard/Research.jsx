import React,{useState} from 'react'
import {DataComponent,DataTable,Icon,Section,useDataApp} from '../../data-app-public.jsx'

const repoLink=(value,row)=><a className="egm-research-repo" href={row.url} target="_blank" rel="noreferrer">{value}</a>
const wrappedText=value=><span className="egm-research-description">{value??'—'}</span>
const createdDate=value=>value?new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'—'
const focusText=value=>{
  if(!value) return '—'
  const first=String(value).trim().match(/^.*?[.!?](?=\s|$)/)?.[0]??String(value).trim()
  const concise=first.length>140?first.slice(0,137).replace(/\s+\S*$/,'')+'…':first
  return <span className="egm-research-description" title={value}>{concise}</span>
}
const yesNo=value=>value?'Found':'Not matched'
const readmeMatch=value=><span className="egm-research-match" role="img" aria-label={value?'Matched in README':'Not matched in README'} title={value?'Matched in README':'Not matched in README'}>{value?<Icon name="check" size={16}/>:<span aria-hidden="true">−</span>}</span>
const observedGrowth=(value,row)=>value==null?<span title={`Monitoring baseline${row.baselineAt?`: ${row.baselineAt}`:''}`} aria-label="Monitoring baseline">—</span>:`${value>=0?'+':''}${value.toLocaleString('en-US')}`
const starCount=value=>typeof value==='number'?(Math.abs(value)>=1000?`${(value/1000).toFixed(1)}K`:value.toLocaleString('en-US')):'—'
const seoLabels={domain:'Domain',keyword:'Keyword',position:'Position',search_volume:'Search volume',traffic:'Estimated traffic',organic_keywords:'Organic keywords',organic_traffic:'Estimated organic traffic',organic_cost:'Estimated organic traffic value',adwords_keywords:'Paid keywords',adwords_traffic:'Estimated paid traffic',backlinks:'Backlinks',total:'Total',referring_domains:'Referring domains',referring_ips:'Referring IPs',common_keywords:'Shared keywords',competition_level:'Competition level',url:'URL'}
const seoColumn=field=>({field,label:seoLabels[field]??field.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase()),...(['keyword','url','domain'].includes(field)?{renderCell:wrappedText}:{})})
const backlinkLabels={total:'Backlinks',domains_num:'Referring domains',ips_num:'Referring IPs',follows_num:'Follow links',nofollows_num:'Nofollow links',score:'Authority score',trust_score:'Trust score',urls_num:'Source URLs',ipclassc_num:'Referring C-class networks',texts_num:'Text links',forms_num:'Form links',frames_num:'Frame links',images_num:'Image links'}
const externalCell=(value,row)=>{const candidate=row.source_url??row.url??`https://${row.domain}`;try{const url=new URL(candidate);if(url.protocol!=='https:'&&url.protocol!=='http:')return wrappedText(value);return <a className="egm-research-repo" href={url.href} target="_blank" rel="noreferrer">{value||url.hostname}</a>}catch{return wrappedText(value)}}
const crawlDate=value=>typeof value==='number'?createdDate(new Date(value*1000).toISOString()):'—'
const seoColumns=(id,rows)=>id==='seo_referring_domains'?[{field:'domain',label:'Domain',renderCell:externalCell},{field:'backlinks_num',label:'Backlinks'},{field:'first_seen',label:'First crawled',renderCell:crawlDate}]:id==='seo_top_backlinks'?[{field:'source_title',label:'Source page',renderCell:externalCell},{field:'anchor',label:'Anchor text',renderCell:wrappedText},{field:'first_seen',label:'First crawled',renderCell:crawlDate}]:[...new Set(rows.flatMap(row=>Object.keys(row)))].map(seoColumn)
function SearchVisibility({queries}) {
  const statusQuery=queries.semrush_status
  const status=statusQuery?.rows?.[0]
  const reportLabels=[['seo_backlinks','Backlinks'],['seo_referring_domains','Referring domains'],['seo_top_backlinks','Backlink source pages'],['seo_overview','Domain overview'],['seo_keywords','Organic keywords'],['seo_competitors','Search competitors']]
  const reports=reportLabels.filter(([id])=>queries[id]?.rows?.length)
  const missing=reportLabels.filter(([id])=>queries[id]&&status?.reportStates?.[id]==='no_data')
  const coverageIds=['semrush_status',...missing.map(([id])=>id)]
  const coverageRows=Object.fromEntries(coverageIds.map(id=>[id,queries[id]?.rows??[]]))
  const unavailableCopy=status?.reason==='no_api_units'?'The connected Semrush account has no MCP API units. Activate MCP access on the trial account, then reconnect Semrush with that account.':status?.status==='expired'?'The configured Semrush collection window has ended. Previously collected evidence remains available below.':'Semrush has not returned a successful collection. Its current status and collection details are available in Sources.'
  return <Section title="Search visibility" id="research-semrush">
    {reports.map(([id,title])=>{const sourceRows=queries[id].rows;const isBacklinks=id==='seo_backlinks'&&sourceRows.length===1;const rows=isBacklinks?Object.entries(sourceRows[0]).map(([field,value])=>({metric:backlinkLabels[field]??field,value})):sourceRows;return <DataComponent key={id} id={`research-${id.replaceAll('_','-')}`} queryId={id} title={title} kind="table" variant="card" displayRows={rows} sourceRows={sourceRows}>
      {status?.reportStates?.[id]==='no_data'?<p className="egm-copy">Semrush returned no matching records for egm.dev with these report parameters. This does not establish zero traffic, keywords, or competitors.</p>:<DataTable rows={rows} label={`Semrush ${title.toLowerCase()}`} searchable={rows.length>8&&!isBacklinks} columns={isBacklinks?[{field:'metric',label:'Measure'},{field:'value',label:'Value'}]:seoColumns(id,rows)} />}
    </DataComponent>})}
    {statusQuery&&<DataComponent id="research-semrush-status" queryId="semrush_status" queryIds={coverageIds} title="Semrush coverage" kind="custom" variant="card" displayRows={statusQuery.rows} sourceRowsByQuery={coverageRows}>
      {missing.length>0&&<p className="egm-note">No matching records for egm.dev in the {status?.database?.toUpperCase()??'selected'} search database: {missing.map(([,label])=>label.toLowerCase()).join(', ')}. This does not establish zero traffic, keywords, or competitors.</p>}
      {status?.status!=='available'&&<p className="egm-note">{status?.status==='stale'?'The latest collection failed. The tables retain the last successful results.':unavailableCopy}</p>}
      <p className="egm-note">Backlinks are global; organic search uses the selected database. For first-party search clicks and impressions, <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">set up Google Search Console</a>.</p>
    </DataComponent>}
  </Section>
}
function DiscussionSignals({queries}) {
  const query=queries.research_evidence
  const statusQuery=queries.research_status
  if(!query) return null
  const rows=query.rows??[]
  const verified=rows.filter(row=>row.status==='verified')
  const unchecked=rows.filter(row=>row.status!=='verified')
  const proposals={workflow:'Test one workflow example with new users; track their first successful result.',demo:'Test a short demo; track the first successful workflow afterward.',install:'Run a first-install test with new users; record completion.',friction:'Test the quoted workflow step; record where users stop.'}
  return <Section title="Verified discussion signals" id="research-discussion">
    <DataComponent id="research-discussion-evidence" queryId="research_evidence" title="Source checks and experiment proposals" kind="custom" variant="card" displayRows={rows} sourceRows={rows}>
      <div className="egm-discussion-list" data-reviewed-rows>{verified.map(row=>{const signal=row.themes?.[0];const quote=signal?.quote?.trim().split(/\s+/).slice(0,24).join(' ');return <article key={row.url}>
        <h3><a href={row.url} target="_blank" rel="noreferrer">{row.title||new URL(row.url).hostname}</a></h3>
        <span className="egm-signal-status">Verified reference</span>
        {quote&&<><p className="egm-signal-quote"><q>{quote}{signal.quote.trim().split(/\s+/).length>24?'…':''}</q></p><p>Suggested test: {proposals[signal.theme]??'Validate this observation with users before changing the product.'}</p></>}
      </article>})}</div>
      {unchecked.length>0&&<details className="egm-unverified-sources"><summary>{unchecked.length} sources not verified</summary>{unchecked.map(row=><p key={row.url}><a href={row.url} target="_blank" rel="noreferrer">{row.title||row.url}</a> · {row.status==='inaccessible'?'Could not retrieve':'Project reference not confirmed'}</p>)}</details>}
      <p className="egm-note">Verified means a project reference was found, not that every claim was validated.</p>
    </DataComponent>
    {statusQuery&&<DataComponent id="research-discussion-status" queryId="research_status" title="Content research coverage" kind="custom" variant="card" displayRows={statusQuery.rows} sourceRows={statusQuery.rows}><p className="egm-note">Collection state: {statusQuery.rows?.[0]?.status??'unknown'}.</p></DataComponent>}
  </Section>
}
function ResearchCandidates({queries}) {
  const [language,setLanguage]=useState('english')
  const [searchOpen,setSearchOpen]=useState(false)
  const [search,setSearch]=useState('')
  const query=queries.exa_research
  if(!query) return null
  const statusQuery=queries.exa_research_status
  const rows=query.rows??[]
  const estimated=rows.some(row=>!row.language)
  const isEnglish=row=>{
    if(row.language)return /^(en(?:[-_]|$)|english$)/i.test(row.language)
    const text=`${row.title??''} ${row.evidence??''}`
    if(/[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))return false
    return (text.toLowerCase().match(/\b(the|and|of|to|for|with|is|in|how|what|why|using|agent|workflow|review|model|code|design|software|skills|google|elephant|goldfish)\b/g)??[]).length>=2
  }
  const selected=rows.filter(row=>(language==='all'||isEnglish(row))&&`${row.title??''} ${row.evidence??''} ${row.domain??''} ${(row.queryAngles??[]).join(' ')}`.toLowerCase().includes(search.toLowerCase().trim()))
  const controls=<div className="egm-research-controls"><select aria-label="Research lead language" value={language} onChange={event=>setLanguage(event.target.value)}><option value="english">English{estimated?' (estimated)':''}</option><option value="all">All languages</option></select>{searchOpen&&<input id="research-leads-search" autoFocus type="search" value={search} onChange={event=>setSearch(event.target.value)} aria-label="Search research leads" placeholder="Search leads"/>}<button type="button" aria-label={searchOpen?'Close research search':'Search research leads'} aria-expanded={searchOpen} aria-controls="research-leads-search" onClick={()=>{setSearchOpen(!searchOpen);if(searchOpen)setSearch('')}}><Icon name={searchOpen?'close':'search'} size={16}/></button></div>
  return <Section title="Research leads" id="research-candidates">
    <DataComponent id="research-candidate-table" queryId="exa_research" title="Discussion, tutorial, and workflow candidates" kind="custom" variant="card" headerControls={controls} displayRows={selected} sourceRows={rows}>
      <div className="egm-research-leads" data-reviewed-rows>{selected.map(row=><article key={row.url}><div><h3><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a></h3><p className="egm-note">{(row.queryAngles??[]).join(' · ')}</p></div><p className="egm-research-excerpt">{row.evidence}</p></article>)}</div>
      {!selected.length&&<p className="egm-note">No leads match these filters.</p>}
      <p className="egm-note">{selected.length} of {rows.length} leads. Unverified results may include first-party posts and mirrors.{estimated&&language==='english'?' English is estimated from indexed text; choose All languages to review every result.':''}</p>
    </DataComponent>
    {statusQuery&&<DataComponent id="research-candidate-status" queryId="exa_research_status" title="Research search coverage" kind="custom" variant="card" displayRows={statusQuery.rows} sourceRows={statusQuery.rows}><p className="egm-note">Collection state: {statusQuery.rows?.[0]?.status??'unknown'}.</p></DataComponent>}
  </Section>
}
export function Research() {
  const {queries}=useDataApp()
  const peers=queries.peers?.rows??[],emerging=queries.emerging?.rows??[]
  if(!peers.length) return <><p className="egm-note">Repo research has not completed its first source collection.</p><DiscussionSignals queries={queries}/><ResearchCandidates queries={queries}/><SearchVisibility queries={queries}/></>
  const egm=peers.find(r=>r.repo==='google/elephant-goldfish-model')
  const alternatives=peers.filter(r=>r!==egm)
  const media=alternatives.filter(r=>r.demo).length
  const quick=alternatives.filter(r=>r.quickStart).length
  const ref=queries.referrers?.rows??[]
  const total=ref.reduce((s,r)=>s+r.count,0)
  const searchVideo=ref.filter(r=>['Google','youtube.com'].includes(r.referrer)).reduce((s,r)=>s+r.count,0)
  const popular=queries.paths?.rows?.find(r=>r.path.includes('/docs/'))
  const opportunityQueryIds=['peers','referrers','paths'].filter(id=>queries[id])
  const opportunitySourceRows=Object.fromEntries(opportunityQueryIds.map(id=>[id,queries[id]?.rows??[]]))
  const suggestions=[
    ...(egm?[
      {title:'First-run discovery',evidence:`${quick} of ${alternatives.length} peer READMEs match a quick-start or installation heading. EGM: ${yesNo(egm.quickStart).toLowerCase()}.`,action:egm.quickStart?'Test the existing first-run path with new users and measure completion.':'Test a short, prominent first-run section before expanding the documentation.',source:egm.readmeUrl},
      {title:'Show the workflow',evidence:`${media} of ${alternatives.length} peer READMEs contain a matched video or animated media link. EGM: ${yesNo(egm.demo).toLowerCase()}.`,action:egm.demo?'Measure clicks and first successful runs from the existing demo.':'Test a short workflow demonstration showing a concrete input, review, and resulting change.',source:egm.readmeUrl}
    ]:[]),
    ...(total?[{title:'Channel concentration',evidence:`Google and YouTube account for ${(searchVideo/total*100).toFixed(1)}% of reported referral views.`,action:'Test one additional distribution channel and compare attributed views. This is an experiment proposal, not evidence of causal lift.',source:'https://github.com/google/elephant-goldfish-model/graphs/traffic'}]:[]),
    ...(popular?[{title:'Follow observed content interest',evidence:`${popular.path.replace('/google/elephant-goldfish-model','').replace('/blob/main','')} received ${popular.count.toLocaleString('en-US')} views.`,action:'Test a clearer route from this documentation page to installation and the first successful workflow.',source:'https://github.com'+popular.path}]:[])
  ]
  return <>
    <Section title="Comparable repos" id="research-peers" spacing="none">
      <DataComponent id="research-peer-table" queryId="peers" title="Reach and first-run discovery" kind="table" variant="card" displayRows={peers} sourceRows={peers}>
        <DataTable rows={peers} searchable={false} label="Comparable repo signals" columns={[{field:'repo',label:'Repo',renderCell:repoLink},{field:'stars',label:'Stars',renderCell:starCount},{field:'observedDelta',label:'Since monitoring',renderCell:observedGrowth},{field:'quickStart',label:'Quick start',renderCell:readmeMatch},{field:'demo',label:'Demo',renderCell:readmeMatch}]} />
        <p className="egm-note">Peers differ in age and scope. Growth uses the first recorded observation; README checks are text matches.</p>
      </DataComponent>
    </Section>
    <Section title="Gaps and experiments" id="research-opportunities">
      <DataComponent id="research-opportunity-list" queryId="peers" queryIds={opportunityQueryIds} title="Opportunities to test" kind="custom" variant="card" displayRows={suggestions} sourceRowsByQuery={opportunitySourceRows}>
        <div className="egm-opportunities">{suggestions.map(item=><div key={item.title}><h3>{item.title}</h3><p className="egm-action">{item.action}</p><p className="egm-action-evidence">{item.evidence} <a className="egm-evidence-link" href={item.source} target="_blank" rel="noreferrer" aria-label={`View evidence for ${item.title}`} title={`View evidence for ${item.title}`}><Icon name="arrowUpRight" size={14}/></a></p></div>)}</div>
      </DataComponent>
    </Section>
    <DiscussionSignals queries={queries}/>
    <ResearchCandidates queries={queries}/>
    <Section title="Newly popular agent repos" id="research-discovery">
      <DataComponent id="research-emerging-table" queryId="emerging" title="Created in the last 30 days" kind="table" variant="card" displayRows={emerging} sourceRows={emerging}>
        <DataTable rows={emerging} searchable={false} label="Newly popular agent repos" columns={[{field:'repo',label:'Repo',renderCell:repoLink},{field:'stars',label:'Stars',renderCell:starCount},{field:'created',label:'Created',renderCell:createdDate},{field:'description',label:'Focus',renderCell:focusText}]} />
        <p className="egm-note">GitHub search for agent-related descriptions, over 100 stars, created in the last 30 days. Ranked by current total stars. This is discovery, not GitHub Trending or proof of virality.</p>
      </DataComponent>
    </Section>
    <SearchVisibility queries={queries} />
  </>
}
