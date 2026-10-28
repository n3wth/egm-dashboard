import React, { useEffect } from 'react'
import { ChartTooltip, DataComponent, DataTable, EvidenceChart, Icon, MetricCard, MetricSparkline, Section, SortableItem, SortableRegion, useDataApp, useDashboardTabs } from '../../data-app-public.jsx'
import './egm.css'
import {Research} from './Research.jsx'
import {Mentions} from './Mentions.jsx'
import channelIcons from './channel-icons.json'
import {SiteName} from './SiteName.jsx'
import {researchProposal} from './research-insights.js'

const tabs = [{id:'reach',label:'Overview',previousLabels:['Reach'],filterIds:[]},{id:'acquisition',label:'Acquisition',filterIds:[]},{id:'adoption',label:'Adoption',filterIds:[]},{id:'website',label:'Website',previousLabels:['egm.dev'],filterIds:[]},{id:'development',label:'Development',filterIds:[]},{id:'research',label:'Research',filterIds:[]},{id:'mentions',label:'Mentions',filterIds:[]}]
const n = value => value == null ? 'Unavailable' : Number(value).toLocaleString('en-US')
const shortDate = date => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))
const dateSpan = rows => `${shortDate(rows[0].date)}–${shortDate(rows.at(-1).date)}`
const sum = (rows, field) => rows.reduce((a,r) => a+r[field],0)
const line = (y,fields=[y]) => ({type:'line',x:'date',y,fields,colors:Object.fromEntries(fields.map((field,index)=>[field,index%2?'var(--chart-4)':'var(--chart-1)'])),stackable:false,showXAxisLabel:false,showYAxisLabel:false,valueDecimals:0,startAtZero:true})
const sourceLabel = value => ({Google:'Google','youtube.com':'YouTube','linkedin.com':'LinkedIn (web)','com.linkedin.android':'LinkedIn (Android)','github.com':'GitHub','teams.public.onecdn.static.microsoft':'Teams','l.threads.com':'Threads',Bing:'Bing',DuckDuckGo:'DuckDuckGo','egm.dev':'egm.dev'}[value] ?? value)
const pathLabel = value => {
  const path = value.replace(/^\/google\/elephant-goldfish-model(?=\/|$)/,'')
  if (!path) return 'Repo home'
  if (path === '/tree/main') return 'Source root'
  return path.replace(/^\/(blob|tree)\/main(?=\/|$)/,'')
}
const repoPathLink = value => {
  if (typeof value !== 'string') return '—'
  const label = pathLabel(value)
  if (!/^\/google\/elephant-goldfish-model(?:\/[^?#\\\s]*)?$/.test(value) || value.split('/').some(part=>part==='.' || part==='..')) return label
  return <a href={`https://github.com${value}`} target="_blank" rel="noreferrer">{label}</a>
}
const combinedReferralViews = rows => {
  const groups = new Map()
  for (const row of rows) {
    const source = row.referrer === 'linkedin.com' || row.referrer === 'com.linkedin.android' ? 'LinkedIn' : sourceLabel(row.referrer)
    groups.set(source, (groups.get(source) ?? 0) + row.count)
  }
  return [...groups].map(([source,count])=>({source,count,__categoryIcon:channelIcons[source]?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(channelIcons[source].replaceAll('currentColor','#a0a0a0')):undefined})).sort((a,b)=>b.count-a.count)
}
function StarTooltip({active,payload=[],label}) {
  const row=payload[0]?.payload
  const starFields=payload.length>0&&payload.every(item=>['stars','completedStars','partialStars'].includes(item.dataKey))
  const details=starFields&&Number.isFinite(row?.stars)?[{label:'Stars',value:n(row.stars)}]:payload.filter(item=>item.value!=null).map(item=>({label:String(item.name??item.dataKey).replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase()),value:n(item.value)}))
  if(row?.coverage)details.push({label:'Coverage',value:row.coverage})
  return <ChartTooltip active={active} label={row?.date?shortDate(row.date):label} details={details}/>
}
function Plot({id,queryId,title,rows,spec,description,sourceRows=rows,children,chartOptions}) {
  const brandedSpec = { ...spec, colors: spec.colors ?? {[spec.y]:'var(--chart-1)'} }
  return <EvidenceChart {...{id,queryId,title,rows,description,sourceRows,chartOptions}} spec={brandedSpec} variant="card" height={300}>{children}</EvidenceChart>
}
function Table({id,queryId,title,rows,columns,searchable=false}) {
  return <DataComponent {...{id,queryId,title}} kind="table" variant="card" displayRows={rows} sourceRows={rows}><DataTable {...{rows,columns,searchable}} label={title} /></DataComponent>
}
function AcrossEgm({queries,reach,web}) {
  const ids=['website','reach','youtube_videos','research_evidence'].filter(id=>queries[id])
  const sourceRowsByQuery=Object.fromEntries(ids.map(id=>[id,queries[id].rows]))
  const strongest=(queries.youtube_videos?.rows??[]).filter(row=>Number.isFinite(row.views)&&/^[A-Za-z0-9_-]{11}$/.test(row.videoId??'')).sort((a,b)=>b.views-a.views)[0]
  const discussion=(queries.research_evidence?.rows??[]).find(row=>row.status==='verified'&&row.themes?.length)
  const viewShare=reach.views>0?web.referralViews/reach.views:null
  const visitorShare=reach.visitors>0?web.referralVisitors/reach.visitors:null
  const displayRows=[{signal:'Website referrals',views:web.referralViews,viewShare,visitorShare},...(strongest?[{signal:'Observed video views',url:strongest.url,views:strongest.views}]:[]),...(discussion?[{signal:'Verified project reference',url:discussion.url,theme:discussion.themes[0].theme}]:[])]
  return <DataComponent id="overview-across-egm" queryId="website" queryIds={ids} title="Highlights" kind="custom" variant="card" displayRows={displayRows} sourceRowsByQuery={sourceRowsByQuery}>
    <div className="egm-overview-signals" data-reviewed-rows>
      <article><h3>Website referrals</h3><dl className="egm-overview-ratios"><div><dd>{viewShare==null?'Unavailable':`${(viewShare*100).toFixed(1)}%`}</dd><dt>of repo views</dt></div><div><dd>{visitorShare==null?'Unavailable':`${(visitorShare*100).toFixed(1)}%`}</dd><dt>of repo visitors</dt></div></dl><a className="egm-overview-next" href="/website">Website <Icon name="arrowUpRight" size={14}/></a></article>
      <article><h3>Top video</h3>{strongest?<><a className="egm-overview-video" href={`https://www.youtube.com/watch?v=${strongest.videoId}`} target="_blank" rel="noreferrer"><img src={`https://i.ytimg.com/vi/${strongest.videoId}/hqdefault.jpg`} loading="lazy" alt="" width="480" height="360"/><span title={strongest.title}>{strongest.title}</span></a><p>{new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(strongest.views)} observed views · {strongest.channel??'YouTube'}</p></>:<p>Video view counts unavailable.</p>}<a className="egm-overview-next" href="/mentions">Mentions <Icon name="arrowUpRight" size={14}/></a></article>
      <article><h3>Next experiment</h3>{discussion?<><p className="egm-overview-action">{researchProposal(discussion.themes[0].theme)}</p><p className="egm-overview-quote">“{discussion.themes[0].quote}”</p><a className="egm-overview-source" href={discussion.url} target="_blank" rel="noreferrer"><SiteName url={discussion.url}/></a></>:<p>Discussion evidence not verified yet.</p>}<a className="egm-overview-next" href="/research">Research <Icon name="arrowUpRight" size={14}/></a></article>
    </div>
  </DataComponent>
}
export function DashboardContent() {
  const {queries,appTitle,setAppTitle} = useDataApp()
  useEffect(() => {
    if (appTitle === 'EGM performance') setAppTitle('EGM Growth Dashboard')
  }, [appTitle,setAppTitle])
  const {activeTabId} = useDashboardTabs(tabs)
  if(activeTabId==='research') return <Research />
  if(activeTabId==='mentions') return <Mentions />
  const rows = id => queries[id]?.rows??[]
  const reach = rows('reach')[0], daily = rows('traffic'), web = rows('website')[0], queue = rows('maintenance')[0]
  const recentDays=daily.slice(-3),recentViews=sum(recentDays,'views'),windowViews=sum(daily,'views')
  const item = (id,span,content,kind='chart') => <SortableItem key={id} id={id} label={id} kind={kind} className={`egm-block egm-block--${kind}`} style={{'--egm-span':span}}>{content}</SortableItem>
  const metric = (id,queryId,title,value,description,secondary) => {
    const field = {'unique-visitors':'visitors','total-views':'views','total-clones':'clones',stars:'stars','website-visitors':'referralVisitors','website-views':'referralViews'}[id]
    const websiteMetric=id.startsWith('website-')
    const historyQuery=websiteMetric?'website_referral_history':id==='stars'?'star_history':'traffic'
    const history=rows(historyQuery)
    const trendValues=field?history.map(row=>row[field]).filter(Number.isFinite):[]
    const queryIds=[...new Set([queryId,...(field&&queries[historyQuery]?[historyQuery]:[]),...(websiteMetric?['reach']:[])])]
    const trend = {trendValues,trendLabel:websiteMetric?'Observed rolling 14-day GitHub referrals since monitoring began':id === 'stars' ? 'Cumulative current stargazers by Pacific date' : `Daily ${field}, ${dateSpan(daily)}`,queryIds,sourceRowsByQuery:Object.fromEntries(queryIds.map(key=>[key,rows(key)]))}
    return <DataComponent {...{id,queryId,title,description}} kind="metric" variant="card" queryIds={trend.queryIds} displayRows={rows(queryId)} sourceRows={rows(queryId)} sourceRowsByQuery={trend.sourceRowsByQuery}>
      <div className="egm-metric-reading" data-reviewed-rows><span className="egm-metric-value">{n(value)}</span>{field&&trendValues.length>=2&&<MetricSparkline values={trend.trendValues} label={trend.trendLabel} tone="neutral" className="egm-metric-sparkline" />}</div>
      {secondary&&<p className="egm-metric-secondary" data-reviewed-rows>{secondary}</p>}
    </DataComponent>
  }
  if(activeTabId==='acquisition') {
    const channels = combinedReferralViews(rows('referrers'))
    const attributed = sum(channels,'count')
    const searchVideoViews=sum(channels.filter(row=>['Google','YouTube'].includes(row.source)),'count')
    const channelRows = channels.map(row=>({...row,shareOfRepoViews:row.count/reach.views,shareOfReportedReferrals:row.count/attributed}))
    return <>
      <Section id="acquisition-channels-heading" title="Channel contribution" spacing="none">
        <DataComponent id="acquisition-shares" queryId="referrers" queryIds={['referrers','reach']} title="Repo views by channel" kind="table" variant="card" displayRows={channelRows} sourceRowsByQuery={{referrers:rows('referrers'),reach:rows('reach')}}>
          <DataTable rows={channelRows} searchable={false} label="Repo views by channel" columns={[{field:'source',label:'Channel',renderCell:(value,row)=><span style={{display:'inline-flex',alignItems:'center',gap:8,whiteSpace:'nowrap'}}>{row.__categoryIcon&&<img src={row.__categoryIcon} width="16" height="16" alt=""/>}{value}</span>},{field:'count',label:'Views',renderCell:value=><span style={{display:'flex',alignItems:'center',gap:10,minWidth:105,justifyContent:'flex-end'}}><span aria-hidden="true" style={{display:'block',width:70,height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:`${channels[0]?.count?value/channels[0].count*100:0}%`,background:'var(--chart-1)',borderRadius:3}}/></span><span style={{minWidth:38,fontVariantNumeric:'tabular-nums'}}>{n(value)}</span></span>},{field:'shareOfRepoViews',label:'All repo views',renderCell:v=>`${(v*100).toFixed(1)}%`},{field:'shareOfReportedReferrals',label:'Reported referrals',renderCell:v=>`${(v*100).toFixed(1)}%`}]} />
          {attributed>0&&reach.views>0&&<p className="egm-note">Google and YouTube account for {(searchVideoViews/attributed*100).toFixed(1)}% of top reported referral views, or {(searchVideoViews/reach.views*100).toFixed(1)}% of all repo views. Test a clearer first-run path for these visitors.</p>}
        </DataComponent>
      </Section>
      <Section id="acquisition-content-heading" title="Content attracting attention">
        <Table id="acquisition-pages" queryId="paths" title="Popular repo pages" rows={rows('paths')} columns={[{field:'path',label:'Page',renderCell:repoPathLink},{field:'count',label:'Views'},{field:'uniques',label:'Visitors'}]} />
      </Section>
    </>
  }
  if(activeTabId==='adoption') return <>
    <Section id="adoption-signals-heading" title="Acquisition of the code" spacing="none" columns={2}>
      {metric('adoption-cloners','reach','Unique cloners',reach.cloners,'GitHub period-level unique cloners. Includes automation and repeat environments.')}
      {metric('adoption-clones','reach','Clone operations',reach.clones,'Operations, not verified installs or active users.')}
    </Section>
    <Section id="adoption-depth-heading" title="Download signals">
      <Plot id="adoption-clone-history" queryId="traffic" title="Daily clone activity" rows={daily} spec={{...line('clones',['clones','cloners']),legend:{labels:{clones:'Clone operations',cloners:'Unique cloners per day'}}}} />
      <Table id="adoption-release-downloads" queryId="downloads" title="Release asset downloads" rows={rows('downloads')} columns={[{field:'release',label:'Release'},{field:'asset',label:'Asset'},{field:'downloads',label:'Downloads'}]} />
      <DataComponent id="adoption-measurement-gap" queryId="traffic" queryIds={['traffic','maintenance','downloads']} title="Prioritize the first successful workflow" kind="custom" variant="card" displayRows={[{recentViews,windowViews,openIssues:queue.openIssues}]} sourceRowsByQuery={{traffic:daily,maintenance:rows('maintenance'),downloads:rows('downloads')}}>
        <p className="egm-copy" data-editable-id="adoption-next-measure">{windowViews>0&&recentDays.length===3?`${(recentViews/windowViews*100).toFixed(1)}% of reported repo views arrived ${dateSpan(recentDays)} UTC. `:''}Review first-run blockers in the current {n(queue.openIssues)}-issue queue, then track successful workflow completion.</p>
        <p className="egm-note">Release downloads are lifetime asset counts, not the selected traffic period. SHA256SUMS is a checksum file. Git-based plugin installs are not counted here.</p>
      </DataComponent>
    </Section>
  </>
  if(activeTabId==='website') return <>
    <Section id="website-flow-title" title="egm.dev → GitHub" spacing="none" columns={2}>
      {metric('website-visitors','website','Visitors referred to GitHub',web.referralVisitors,'Rolling 14-day GitHub referrals. Sparkline shows actual observations since monitoring began.',reach.visitors>0?`${(web.referralVisitors/reach.visitors*100).toFixed(1)}% of repo visitors`:undefined)}
      {metric('website-views','website','Repo views from egm.dev',web.referralViews,'Rolling 14-day GitHub referrals. Sparkline shows actual observations since monitoring began.',reach.views>0?`${(web.referralViews/reach.views*100).toFixed(1)}% of repo views`:undefined)}
    </Section>
    <Section id="website-measurement-title">
      <DataComponent id="website-measurement" queryId="website_contribution" title="egm.dev’s share of reach" kind="custom" displayRows={rows('website_contribution')} sourceRows={rows('website_contribution')} variant="card">
        <dl className="egm-contribution" data-reviewed-rows><div><dt>Referral rank by views</dt><dd>#{rows('website_contribution')[0].rank}</dd></div><div><dt>Share of all repo views</dt><dd>{(rows('website_contribution')[0].viewShare*100).toFixed(1)}%</dd></div><div><dt>Share of top-ten referral views</dt><dd>{(rows('website_contribution')[0].topTenShare*100).toFixed(1)}%</dd></div></dl>
        <p className="egm-note">Ranked among GitHub’s ten reported referring sources. View shares measure traffic attributed to egm.dev, not website conversion. Website visitor totals are unavailable.</p>
      </DataComponent>
      <Plot id="website-referrals" queryId="referrers" title="Views by referring source" rows={combinedReferralViews(rows('referrers'))} sourceRows={rows('referrers')} spec={{type:'horizontalBar',presentation:'plot',x:'source',y:'count',valueDecimals:0,showValues:true,showXAxisLabel:false,showYAxisLabel:false}} description="LinkedIn web and Android views are combined. Unique visitors cannot be deduplicated across sources." />
    </Section>
  </>
  if(activeTabId==='development') return <>
    <Section id="development-summary" title="Development" spacing="none">
    <SortableRegion id="development:canvas" variant="freeform" className="egm-dashboard-grid egm-development-grid" authoredRevision={2} rows={[
      {id:'dev:metrics',kind:'metrics',items:['open-issues','open-prs','merged-prs']},
      {id:'dev:activity',items:['pr-activity','issue-activity']},
      {id:'dev:queue',items:['issue-queue']},{id:'dev:downloads',items:['downloads']}
    ]}>
      {item('open-issues',4,metric('open-issues','maintenance','Open issues',queue.openIssues),'metric')}
      {item('open-prs',4,metric('open-prs','maintenance','Open PRs',queue.openPRs,`Includes ${queue.draftPRs} draft PRs.`),'metric')}
      {item('merged-prs',4,metric('merged-prs','activity','Merged PRs',sum(rows('activity'),'mergedPRs'),dateSpan(daily)),'metric')}
      {item('pr-activity',6,<Plot id="pr-activity" queryId="activity" title="Daily merged PRs" rows={rows('activity')} spec={{...line('mergedPRs'),type:'bar'}} />)}
      {item('issue-activity',6,<Plot id="issue-activity" queryId="activity" title="Daily issue activity" rows={rows('activity')} spec={{...line('openedIssues',['openedIssues','closedIssues']),colors:{openedIssues:'var(--chart-1)',closedIssues:'var(--chart-4)'},legend:{labels:{openedIssues:'Opened issues',closedIssues:'Closed issues'}}}} />)}
      {item('issue-queue',12,<Table id="issue-queue" queryId="issue_queue" title="Open issues by discussion volume" rows={rows('issue_queue')} searchable columns={[{field:'number',label:'#'},{field:'title',label:'Issue',renderCell:(v,r)=><a href={r.url} target="_blank" rel="noreferrer">{v}</a>},{field:'comments',label:'Comments'}]} />,'table')}
      {item('downloads',12,<Table id="downloads" queryId="downloads" title="Release asset downloads" rows={rows('downloads')} columns={[{field:'release',label:'Release'},{field:'asset',label:'Asset'},{field:'downloads',label:'Downloads'}]} />,'table')}
    </SortableRegion>
    </Section>
    <p className="egm-note">Clone operations and release downloads do not establish installs, activation, or repeat usage. Issue comments indicate discussion, not severity. SHA256SUMS is a checksum file.</p>
  </>
  const comparison = ['views','clones'].map(field => {
    const previous=sum(daily.slice(-14,-7),field), current=sum(daily.slice(-7),field)
    return {metric:field==='views'?'Repo views':'Clone operations',previous,current,change:previous?(current/previous-1)*100:null}
  })
  const starHistory=rows('star_history')
  const historyObservedAt=queries.star_history?.source?.executedAt
  const observedPacificDate=historyObservedAt?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(historyObservedAt)):null
  const partialStarDay=starHistory.at(-1)?.date===observedPacificDate
  const starDisplayRows=starHistory.map((row,index)=>({...row,completedStars:partialStarDay&&index===starHistory.length-1?null:row.stars,partialStars:partialStarDay&&index>=starHistory.length-2?row.stars:null,coverage:partialStarDay&&row.date===observedPacificDate?'Partial day':'Complete day'}))
  const starSpec={...line('completedStars',['completedStars','partialStars']),showLegend:false,colors:{completedStars:'var(--chart-1)',partialStars:'color-mix(in srgb, var(--chart-1) 40%, transparent)'}}
  return <>
    <SortableRegion id="reach:canvas" variant="freeform" className="egm-dashboard-grid egm-reach-grid" authoredRevision={3} rows={[
      {id:'reach:metrics',kind:'metrics',items:['unique-visitors','total-views','total-clones','stars']},
      {id:'reach:across',items:['overview-across-egm']},
      {id:'reach:trends',items:['visitor-trend','clone-trend']},
      {id:'reach:comparison',items:['star-history','period-comparison']},
      {id:'reach:sources',items:['referral-chart','popular-paths']}
    ]}>
      {item('unique-visitors',3,metric('unique-visitors','reach','Unique repo visitors',reach.visitors,'Period-level unique count. Daily uniques are not additive.'),'metric')}
      {item('total-views',3,metric('total-views','reach','Repo views',reach.views),'metric')}
      {item('total-clones',3,metric('total-clones','reach','Clone operations',reach.clones,`${n(reach.cloners)} unique cloners. Includes automation.`),'metric')}
      {item('stars',3,metric('stars','reach','Stars',reach.stars,`Current stargazers · ${n(reach.forks)} forks · ${n(reach.watchers)} watching`),'metric')}
      {item('overview-across-egm',12,<AcrossEgm {...{queries,reach,web}}/>,'custom')}
      {item('visitor-trend',6,<Plot id="visitor-trend" queryId="traffic" title="Daily repo reach" rows={daily} spec={{...line('views',['views','visitors']),legend:{labels:{views:'Views',visitors:'Unique visitors per day'}}}} />)}
      {item('clone-trend',6,<Plot id="clone-trend" queryId="traffic" title="Daily clone activity" rows={daily} spec={{...line('clones',['clones','cloners']),legend:{labels:{clones:'Clone operations',cloners:'Unique cloners per day'}}}} />)}
      {item('star-history',12,<Plot id="star-history" queryId="star_history" title="Star accumulation" rows={starDisplayRows} sourceRows={starHistory} spec={starSpec} chartOptions={{tooltipContent:<StarTooltip/>}}><p className="egm-note">Reconstructed from observed stargazers; removed stars are unavailable.{partialStarDay?' Faded segment: partial day.':''}</p></Plot>)}
      {item('period-comparison',12,<DataComponent id="period-comparison" queryId="traffic" title="Seven-day comparison" kind="table" variant="card" displayRows={comparison} sourceRows={daily}>
        <DataTable rows={comparison} searchable={false} label="Seven-day traffic comparison" columns={[{field:'metric',label:'Metric'},{field:'previous',label:dateSpan(daily.slice(-14,-7))},{field:'current',label:dateSpan(daily.slice(-7))},{field:'change',label:'Change (%)',renderCell:v=>v==null?'Unavailable':`${v>=0?'+':''}${n(Math.round(v))}%`}]} />
        <p className="egm-note">The latest seven returned days compared with the preceding seven. Weekly unique visitor counts cannot be calculated from daily uniques.</p>
      </DataComponent>,'table')}
      {item('referral-chart',6,<Plot id="referral-chart" queryId="referrers" title="Top referring sources by repo views" rows={combinedReferralViews(rows('referrers'))} sourceRows={rows('referrers')} spec={{type:'horizontalBar',presentation:'plot',x:'source',y:'count',valueDecimals:0,showValues:true,showXAxisLabel:false,showYAxisLabel:false}} description="GitHub’s top ten source rows grouped by channel. LinkedIn web and Android views are combined; unattributed traffic is excluded." />)}
      {item('popular-paths',6,<Table id="popular-paths" queryId="paths" title="Popular repo pages" rows={rows('paths')} columns={[{field:'path',label:'Path',renderCell:repoPathLink},{field:'count',label:'Views'},{field:'uniques',label:'Visitors'}]} />,'table')}
    </SortableRegion>
  </>
}
