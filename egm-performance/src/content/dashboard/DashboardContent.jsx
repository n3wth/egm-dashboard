import {percentage} from './percentage.mjs'
import React, { useEffect } from 'react'
import { ChartTooltip, DataComponent, DataTable, EvidenceChart, Icon, MetricCard, MetricSparkline, Section, SortableItem, SortableRegion, useDataApp, useDashboardTabs } from '../../data-app-public.jsx'
import './egm.css'
import {Research} from './Research.jsx'
import {Mentions} from './Mentions.jsx'
import channelIcons from './channel-icons.json'
import {SiteName} from './SiteName.jsx'
import {weeklyChange,starWeeklyChange} from './weekly-change.mjs'
import {InsightCallout} from './InsightCallout.jsx'
import {OverviewSummary} from './OverviewSummary.jsx'
import {PageSummary} from './PageSummary.jsx'
import {GrowthAdvice} from './GrowthAdvice.jsx'

const tabs = [{id:'reach',label:'Overview',previousLabels:['Reach'],filterIds:[]},{id:'growth',label:'Growth advice',filterIds:[]},{id:'acquisition',label:'Acquisition',filterIds:[]},{id:'adoption',label:'Adoption',filterIds:[]},{id:'website',label:'Website',previousLabels:['egm.dev'],filterIds:[]},{id:'development',label:'Development',filterIds:[]},{id:'research',label:'Research',filterIds:[]},{id:'mentions',label:'Mentions',filterIds:[]}]
const n = value => value == null ? 'Unavailable' : Number(value).toLocaleString('en-US')
const shortDate = date => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))
const performanceDate = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : 'Unavailable'
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
  const popularVideos=(queries.youtube_videos?.rows??[]).filter(row=>Number.isFinite(row.views)&&row.views>=0&&/^[A-Za-z0-9_-]{11}$/.test(row.videoId??'')).sort((a,b)=>b.views-a.views).slice(0,3)
  const discussion=(queries.research_evidence?.rows??[]).find(row=>row.status==='verified'&&row.themes?.length)
  const experiment={workflow:'Choose one small repo task. Ask three new users to run EGM on it, then record completion and where they stop.',demo:'Show a short EGM demo to three new users. Ask them to repeat the workflow and record whether they finish.',install:'Ask three new users to install EGM and run its first example. Record installation failures and first successful runs.',friction:'Ask three users to repeat the workflow described by this source. Record the step where each gets stuck.'}[discussion?.themes?.[0]?.theme]
  const viewShare=reach.views>0?web.referralViews/reach.views:null
  const visitorShare=reach.visitors>0?web.referralVisitors/reach.visitors:null
  const displayRows=[{signal:'Website referrals',views:web.referralViews,viewShare,visitorShare},...popularVideos.map(video=>({signal:'Observed video views',url:video.url,views:video.views})),...(discussion?[{signal:'Verified project reference',url:discussion.url,theme:discussion.themes[0].theme}]:[])]
  return <DataComponent id="overview-across-egm" queryId="website" queryIds={ids} title="Highlights" kind="custom" variant="card" displayRows={displayRows} sourceRowsByQuery={sourceRowsByQuery}>
    <div className="egm-overview-signals" data-reviewed-rows>
      <article><h3>Site referrals</h3><p className="egm-overview-website-copy">{Number.isFinite(viewShare)&&Number.isFinite(visitorShare)?<><strong>{percentage(viewShare)}</strong> of repo views and <strong>{percentage(visitorShare)}</strong> of repo visitors came via egm.dev.</>:'Referral shares are unavailable.'}</p><a className="egm-overview-next" href="/website">Website <Icon name="arrowUpRight" size={14}/></a></article>
      <article><h3>Popular videos</h3>{popularVideos.length?<div className="egm-overview-videos">{popularVideos.map(video=><a className="egm-overview-video" key={video.videoId} href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer" aria-label={`${video.title??'YouTube video'}. ${n(video.views)} observed views. Open YouTube.`}><span className="egm-overview-video-thumb"><img src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`} loading="lazy" alt="" width="480" height="360"/><span className="egm-overview-video-views" aria-hidden="true">{new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(video.views)}</span></span><span className="egm-overview-video-title" title={video.title}>{video.title??'YouTube video'}</span></a>)}</div>:<p>Video view counts unavailable.</p>}<a className="egm-overview-next" href="/mentions">Mentions <Icon name="arrowUpRight" size={14}/></a></article>
      <article><h3>Recommended experiment</h3>{discussion&&experiment?<><p className="egm-overview-action">{experiment}</p><a className="egm-overview-source" href={discussion.url} target="_blank" rel="noreferrer"><SiteName url={discussion.url}/></a></>:<p>Discussion evidence not verified yet.</p>}<a className="egm-overview-next" href="/research">Research <Icon name="arrowUpRight" size={14}/></a></article>
    </div>
  </DataComponent>
}
export function DashboardContent() {
  const {queries,appTitle,setAppTitle} = useDataApp()
  useEffect(() => {
    if (appTitle === 'EGM performance') setAppTitle('EGM Growth Dashboard')
  }, [appTitle,setAppTitle])
  const {activeTabId} = useDashboardTabs(tabs)
  if(activeTabId==='growth') return <GrowthAdvice />
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
    const historyStale=(queries.star_history?.source?.caveats??[]).some(note=>note.startsWith('Star history is stale:'))
    const weekly=['total-views','total-clones'].includes(id)?weeklyChange(daily,field):id==='stars'&&!historyStale?starWeeklyChange(history,queries.star_history?.source?.executedAt):null
    const queryIds=[...new Set([queryId,...(field&&queries[historyQuery]?[historyQuery]:[]),...(websiteMetric?['reach']:[])])]
    const trend = {trendValues,trendLabel:websiteMetric?'Observed rolling 14-day GitHub referrals since monitoring began':id === 'stars' ? 'Cumulative current stargazers by Pacific date' : `Daily ${field}, ${dateSpan(daily)}`,queryIds,sourceRowsByQuery:Object.fromEntries(queryIds.map(key=>[key,rows(key)]))}
    return <DataComponent {...{id,queryId,title,description}} kind="metric" variant="card" queryIds={trend.queryIds} displayRows={rows(queryId)} sourceRows={rows(queryId)} sourceRowsByQuery={trend.sourceRowsByQuery}>
      <div className="egm-metric-reading" data-reviewed-rows><span className="egm-metric-value">{n(value)}</span>{field&&trendValues.length>=2&&(!websiteMetric||new Set(trendValues).size>=2)&&<MetricSparkline values={trend.trendValues} label={trend.trendLabel} tone="neutral" className="egm-metric-sparkline" />}</div>
      {secondary&&<p className="egm-metric-secondary" data-reviewed-rows>{secondary}</p>}
      {weekly&&<p className="egm-metric-secondary" data-reviewed-rows title={`Latest seven complete reported days (${weekly.mid}–${weekly.end}) compared with the preceding seven.${weekly.reconstructed?' Reconstructed new stars from observed current stargazers; removed stars unavailable. Partial day excluded.':` Additive ${field} counts.`}`}>{weekly.change>=0?'+':''}{Math.round(weekly.change).toLocaleString('en-US')}% w/w</p>}
    </DataComponent>
  }
  if(activeTabId==='acquisition') {
    const channels = combinedReferralViews(rows('referrers'))
    const attributed = sum(channels,'count')
    const searchVideoViews=sum(channels.filter(row=>['Google','YouTube'].includes(row.source)),'count')
    const channelRows = channels.map(row=>({...row,shareOfRepoViews:row.count/reach.views,shareOfReportedReferrals:row.count/attributed}))
    return <>
      <PageSummary page="acquisition" queries={queries}/>
      <Section id="acquisition-channels-heading" spacing="none">
        <DataComponent id="acquisition-shares" queryId="referrers" queryIds={['referrers','reach']} title="Repo views by channel" kind="table" variant="card" displayRows={channelRows} sourceRowsByQuery={{referrers:rows('referrers'),reach:rows('reach')}}>
          {attributed>0&&reach.views>0&&<InsightCallout action="Test a clearer first-run path for these visitors.">Google and YouTube account for {percentage(searchVideoViews/attributed)} of top reported referral views, or {percentage(searchVideoViews/reach.views)} of all repo views.</InsightCallout>}
          <DataTable rows={channelRows} searchable={false} label="Repo views by channel" columns={[{field:'source',label:'Channel',renderCell:(value,row)=><span style={{display:'inline-flex',alignItems:'center',gap:8,whiteSpace:'nowrap'}}>{row.__categoryIcon&&<img src={row.__categoryIcon} width="16" height="16" alt=""/>}{value}</span>},{field:'count',label:'Views',renderCell:value=><span style={{display:'flex',alignItems:'center',gap:10,minWidth:105,justifyContent:'flex-end'}}><span aria-hidden="true" style={{display:'block',width:70,height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:`${channels[0]?.count?value/channels[0].count*100:0}%`,background:'var(--chart-1)',borderRadius:3}}/></span><span style={{minWidth:38,fontVariantNumeric:'tabular-nums'}}>{n(value)}</span></span>},{field:'shareOfRepoViews',label:'All repo views',renderCell:v=>percentage(v)},{field:'shareOfReportedReferrals',label:'Reported referrals',renderCell:v=>percentage(v)}]} />
        </DataComponent>
      </Section>
      <Section id="acquisition-content-heading">
        <Table id="acquisition-pages" queryId="paths" title="Popular repo pages" rows={rows('paths')} columns={[{field:'path',label:'Page',renderCell:repoPathLink},{field:'count',label:'Views'},{field:'uniques',label:'Visitors'}]} />
      </Section>
    </>
  }
  if(activeTabId==='adoption') return <>
    <PageSummary page="adoption" queries={queries}/>
    <Section id="adoption-signals-heading" spacing="none" columns={2}>
      {metric('adoption-cloners','reach','Unique cloners',reach.cloners,'Distinct cloners counted by GitHub across the reporting window. Repeat clones by the same cloner count once. Automated tools and repeat environments can be included; daily unique counts cannot be added.')}
      {metric('adoption-clones','reach','Clone operations',reach.clones,'Times the repo was copied using Git during the reporting window, including repeat copies and automated tools. This does not measure installs or active users.')}
    </Section>
    <Section id="adoption-depth-heading" title="Download signals">
      <Plot id="adoption-clone-history" queryId="traffic" title="Daily clone activity" rows={daily} spec={{...line('clones',['clones','cloners']),legend:{labels:{clones:'Clone operations',cloners:'Unique cloners per day'}}}} />
      <Table id="adoption-release-downloads" queryId="downloads" title="Release asset downloads" rows={rows('downloads')} columns={[{field:'release',label:'Release'},{field:'asset',label:'Asset'},{field:'downloads',label:'Downloads'}]} />
      <DataComponent id="adoption-measurement-gap" queryId="traffic" queryIds={['traffic','maintenance','downloads']} title="Prioritize the first successful workflow" kind="custom" variant="card" displayRows={[{recentViews,windowViews,openIssues:queue.openIssues}]} sourceRowsByQuery={{traffic:daily,maintenance:rows('maintenance'),downloads:rows('downloads')}}>
        {windowViews>0&&recentDays.length===3&&<InsightCallout action={`Review first-run blockers in the current ${n(queue.openIssues)}-issue queue, then track successful workflow completion.`}>{`${percentage(recentViews/windowViews)} of reported repo views arrived ${dateSpan(recentDays)} UTC.`}</InsightCallout>}
        <p className="egm-note">Release downloads are lifetime asset counts, not the selected traffic period. SHA256SUMS is a checksum file. Git-based plugin installs are not counted here.</p>
      </DataComponent>
    </Section>
  </>
  if(activeTabId==='website') return <>
    <PageSummary page="website" queries={queries}/>
    <Section id="website-flow-title" spacing="none" columns={2}>
      {metric('website-visitors','website','Visitors to GitHub',web.referralVisitors,'Visitors referred from egm.dev over GitHub’s rolling 14-day window. Sparkline shows actual observations.',reach.visitors>0?`${percentage(web.referralVisitors/reach.visitors)} of repo visitors`:undefined)}
      {metric('website-views','website','GitHub views',web.referralViews,'Repo views referred from egm.dev over GitHub’s rolling 14-day window. Sparkline shows actual observations.',reach.views>0?`${percentage(web.referralViews/reach.views)} of repo views`:undefined)}
    </Section>
    <Section id="website-measurement-title" spacing="content">
      {['pagespeed','crux'].map(name=>{
        const id=`web_${name}`, data=rows(id), status=rows(`${id}_status`)[0], title=name==='pagespeed'?'Mobile lab performance':'Real-user experience'
        const legacy=rows('site_performance').find(row=>row.kind===(name==='pagespeed'?'Lab':'Field') && row.observedAt)
        if (!data.length && legacy) return <DataComponent key={id} id={`website-${id}`} queryId="site_performance" title={title} kind="custom" variant="card" displayRows={[legacy]} sourceRowsByQuery={{site_performance:rows('site_performance')}}>
          <div data-reviewed-rows><p>{name==='pagespeed'?`Performance score: ${legacy.score} / 100`:`LCP: ${legacy.lcp == null ? 'Unavailable' : `${legacy.lcp} ms`} · INP: ${legacy.inp == null ? 'Unavailable' : `${legacy.inp} ms`} · CLS: ${legacy.cls == null ? 'Unavailable' : legacy.cls}`}</p>
          <p className="egm-note">Previous {name==='pagespeed'?'mobile lab test':'phone-only Chrome user data'} observed {performanceDate(legacy.observedAt)} UTC. {name==='crux' && legacy.periodStart && legacy.periodEnd ? `Period: ${legacy.periodStart}–${legacy.periodEnd}. ` : ''}A newer collection is unavailable.</p></div>
        </DataComponent>
        if (!queries[id]) return <div key={id}><h3>{title}</h3><p>Unavailable until the first collection.</p></div>
        const due=status?.nextAttemptAt && Date.parse(status.nextAttemptAt)<Date.now()
        const ended=status?.status==='expired'||(status?.collectionEndsAt && Date.parse(status.collectionEndsAt)<=Date.now())
        const fieldRows=['largest_contentful_paint','interaction_to_next_paint','cumulative_layout_shift'].map(metric=>data.find(row=>row.metric===metric)??{metric})
        const period=fieldRows.find(row=>row.startDate&&row.endDate)
        const labels={largest_contentful_paint:'LCP',interaction_to_next_paint:'INP',cumulative_layout_shift:'CLS'}
        const displayMetric=(value,unit)=>Number.isFinite(value)?`${unit==='ms'?Math.round(value).toLocaleString('en-US'):value.toFixed(2)}${unit==='ms'?' ms':''}`:'Unavailable'
        return <DataComponent key={id} id={`website-${id}`} queryId={id} queryIds={[id,`${id}_status`].filter(key=>queries[key])} title={title} kind="custom" variant="card" displayRows={data} sourceRowsByQuery={{[id]:data,[`${id}_status`]:rows(`${id}_status`)}}>
          <div data-reviewed-rows>
            {status?.status==='stale'&&<p className="egm-note">Last successful result is stale. The latest collection was unavailable.</p>}
            {ended&&<p className="egm-note">Collection window ended. This result will not refresh until collection is re-enabled.</p>}
            {status?.status==='available'&&due&&!ended&&<p className="egm-note">This result is due for refresh.</p>}
            {!data.length?<p>Unavailable{status?.reason?`: ${status.reason.replaceAll('_',' ')}`:'.'}</p>:name==='pagespeed'?<><p>Performance score: {data[0].score} / 100</p><p>LCP: {displayMetric(data[0].lcpMs,'ms')} · CLS: {displayMetric(data[0].cls)} · Blocking time: {displayMetric(data[0].totalBlockingTimeMs,'ms')}</p><p className="egm-note">Simulated mobile home page test, {performanceDate(data[0].fetchedAt)} UTC. Results can vary between runs.</p></>:<><p>{fieldRows.map(row=>`${labels[row.metric]}: ${displayMetric(row.p75,row.metric==='cumulative_layout_shift'?null:'ms')}`).join(' · ')}</p><p>{fieldRows.map(row=>`${labels[row.metric]} good: ${Number.isFinite(row.goodFraction)?percentage(row.goodFraction):'Unavailable'}`).join(' · ')}</p><p className="egm-note">75th percentile and share of eligible Chrome experiences rated good across the origin, all device types. {period?`${performanceDate(period.startDate)}–${performanceDate(period.endDate)}.`:'Collection period unavailable.'}</p></>}
          </div>
        </DataComponent>
      })}
      <DataComponent id="website-measurement" queryId="website_contribution" queryIds={['website_contribution','website','reach']} title="Referral contribution" kind="custom" displayRows={rows('website_contribution')} sourceRowsByQuery={{website_contribution:rows('website_contribution'),website:rows('website'),reach:rows('reach')}} variant="card">
        {rows('website_contribution')[0]&&<InsightCallout action="Tag website-to-GitHub links to compare which first-run content attracts repo visits.">egm.dev ranks #{rows('website_contribution')[0].rank} among reported referrers and contributes {percentage(rows('website_contribution')[0].topTenShare)} of their repo views.</InsightCallout>}
        <p className="egm-note">Ranked among GitHub’s ten reported referring sources. View shares measure traffic attributed to egm.dev, not website conversion. Website visitor totals are unavailable.</p>
      </DataComponent>
      <Plot id="website-referrals" queryId="referrers" title="Views by referring source" rows={combinedReferralViews(rows('referrers'))} sourceRows={rows('referrers')} spec={{type:'horizontalBar',presentation:'plot',x:'source',y:'count',valueDecimals:0,showValues:true,showXAxisLabel:false,showYAxisLabel:false}} description="LinkedIn web and Android views are combined. Unique visitors cannot be deduplicated across sources." />
    </Section>
  </>
  if(activeTabId==='development') return <>
    <PageSummary page="development" queries={queries}/>
    <Section id="development-summary" spacing="none">
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
  const starHistory=rows('star_history')
  const historyObservedAt=queries.star_history?.source?.executedAt
  const observedPacificDate=historyObservedAt?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(historyObservedAt)):null
  const partialStarDay=starHistory.at(-1)?.date===observedPacificDate
  const starDisplayRows=starHistory.map((row,index)=>({...row,completedStars:partialStarDay&&index===starHistory.length-1?null:row.stars,partialStars:partialStarDay&&index>=starHistory.length-2?row.stars:null,coverage:partialStarDay&&row.date===observedPacificDate?'Partial day':'Complete day'}))
  const starSpec={...line('completedStars',['completedStars','partialStars']),showLegend:false,colors:{completedStars:'var(--chart-1)',partialStars:'color-mix(in srgb, var(--chart-1) 40%, transparent)'}}
  return <>
    <OverviewSummary queries={queries}/>
    <SortableRegion id="reach:canvas" variant="freeform" className="egm-dashboard-grid egm-reach-grid" authoredRevision={4} rows={[
      {id:'reach:metrics',kind:'metrics',items:['unique-visitors','total-views','total-clones','stars']},
      {id:'reach:across',items:['overview-across-egm']},
      {id:'reach:trends',items:['visitor-trend','clone-trend']},
      {id:'reach:comparison',items:['star-history']},
      {id:'reach:sources',items:['referral-chart','popular-paths']}
    ]}>
      {item('unique-visitors',3,metric('unique-visitors','reach','Unique visitors',reach.visitors,'Distinct repo visitors counted by GitHub across the reporting window. Repeat visits by the same visitor count once. Daily unique counts cannot be added.'),'metric')}
      {item('total-views',3,metric('total-views','reach','Repo views',reach.views,'GitHub repo pageviews, including repeat visits, over the reporting window.'),'metric')}
      {item('total-clones',3,metric('total-clones','reach','Clone operations',reach.clones,`Times the repo was copied using Git during the reporting window, including repeat copies and automated tools. GitHub counted ${n(reach.cloners)} distinct cloners.`),'metric')}
      {item('stars',3,metric('stars','reach','Total stars',reach.stars,`Latest recorded number of GitHub accounts starring the repo. This is a snapshot total, not stars gained during the traffic window. ${n(reach.forks)} forks; ${n(reach.watchers)} watching.`),'metric')}
      {item('overview-across-egm',12,<AcrossEgm {...{queries,reach,web}}/>,'custom')}
      {item('visitor-trend',6,<Plot id="visitor-trend" queryId="traffic" title="Daily repo reach" rows={daily} spec={{...line('views',['views','visitors']),legend:{labels:{views:'Views',visitors:'Unique visitors per day'}}}} />)}
      {item('clone-trend',6,<Plot id="clone-trend" queryId="traffic" title="Daily clone activity" rows={daily} spec={{...line('clones',['clones','cloners']),legend:{labels:{clones:'Clone operations',cloners:'Unique cloners per day'}}}} />)}
      {item('star-history',12,<Plot id="star-history" queryId="star_history" title="Star accumulation" rows={starDisplayRows} sourceRows={starHistory} spec={starSpec} chartOptions={{tooltipContent:<StarTooltip/>}}><p className="egm-note">Reconstructed from observed stargazers; removed stars are unavailable.{partialStarDay?' Faded segment: partial day.':''}</p></Plot>)}
      {item('referral-chart',6,<Plot id="referral-chart" queryId="referrers" title="Top referring sources by repo views" rows={combinedReferralViews(rows('referrers'))} sourceRows={rows('referrers')} spec={{type:'horizontalBar',presentation:'plot',x:'source',y:'count',valueDecimals:0,showValues:true,showXAxisLabel:false,showYAxisLabel:false}} description="GitHub’s top ten source rows grouped by channel. LinkedIn web and Android views are combined; unattributed traffic is excluded." />)}
      {item('popular-paths',6,<Table id="popular-paths" queryId="paths" title="Popular repo pages" rows={rows('paths')} columns={[{field:'path',label:'Path',renderCell:repoPathLink},{field:'count',label:'Views'},{field:'uniques',label:'Visitors'}]} />,'table')}
    </SortableRegion>
  </>
}
