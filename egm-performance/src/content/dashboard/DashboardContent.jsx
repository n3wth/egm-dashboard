import {percentage} from './percentage.mjs'
import {dateSpan, ratio} from './metric-safety.mjs'
import {safeExternalUrl} from './research-mentions.mjs'
import React, { useEffect, useRef, useState } from 'react'
import { ChartTooltip, DataComponent, DataTable, EvidenceChart, Icon, Section, SortableItem, SortableRegion, useDataApp, useDashboardTabs } from '../../data-app-public.jsx'
import './egm.css'
import {Research} from './Research.jsx'
import {TrendSparkline} from './TrendSparkline.jsx'
import {Mentions} from './Mentions.jsx'
import {pathLabel, popularPageRows, repoPathHref} from './repo-paths.mjs'
import {sourceIcon} from './source-icon.mjs'
import {weeklyChange,starWeeklyChange,weeklyChangeLabel} from './weekly-change.mjs'
import {channelViews,isSearchVideo} from './referrer-channels.mjs'
import {InsightCallout} from './InsightCallout.jsx'
import {OverviewSummary} from './OverviewSummary.jsx'
import {PageSummary} from './PageSummary.jsx'
import {VideoThumbnail} from './VideoThumbnail.jsx'
import {trackDashboardSection} from './usage-analytics.js'
import {EmptyState,StaleNotice} from './DataStates.jsx'
import {CollectionStatus} from './CollectionStatus.jsx'
import {count} from './states.mjs'
import {suggestExperiment} from './suggested-experiment.mjs'
import {videoGrid} from './video-grid.mjs'

const tabs = [{id:'reach',label:'Overview',previousLabels:['Reach'],filterIds:[]},{id:'acquisition',label:'Acquisition',filterIds:[]},{id:'adoption',label:'Adoption',filterIds:[]},{id:'website',label:'Website',previousLabels:['egm.dev'],filterIds:[]},{id:'development',label:'Development',filterIds:[]},{id:'research',label:'Research',filterIds:[]},{id:'mentions',label:'Mentions',filterIds:[]}]
const n = count
const compact = value => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value)
const shortDate = date => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))
const performanceDate = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : 'Unavailable'
const sum = (rows, field) => rows.reduce((a,r) => a+r[field],0)
const line = (y,fields=[y]) => ({type:'line',x:'date',y,fields,colors:Object.fromEntries(fields.map((field,index)=>[field,index%2?'var(--chart-4)':'var(--chart-1)'])),stackable:false,showXAxisLabel:false,showYAxisLabel:false,valueDecimals:0,startAtZero:true})
const pageLink = (value, row) => {
  const label = pathLabel(value)
  const href = repoPathHref(value)
  if (!href) return label
  return <a href={href} target="_blank" rel="noreferrer" title={row?.combined ? 'Opens the main URL. Views also include the HEAD URL.' : undefined}>{label}</a>
}
const combinedReferralViews = rows => channelViews(rows).map(row=>({...row,__categoryIcon:sourceIcon(row.source)}))
const referrerDescription = 'GitHub reports only its top ten referring sources, grouped here by channel (LinkedIn web and Android combined). Traffic outside the top ten is unattributed. Unique visitors cannot be deduplicated across sources.'
const pageColumns = [{field:'path',label:'Page',renderCell:pageLink},{field:'count',label:'Views'},{field:'uniques',label:'Unique visitors',renderCell:(value,row)=>row?.combined?<span title="Unique visitors overlap across the main and HEAD URLs and are not added." aria-label="Unique visitors unknown">—</span>:n(value)}]
const downloadColumns = [{field:'release',label:'Release'},{field:'asset',label:'Asset'},{field:'downloads',label:'Downloads'}]
const webVitals = {largest_contentful_paint:'Largest Contentful Paint',interaction_to_next_paint:'Interaction to Next Paint',cumulative_layout_shift:'Cumulative Layout Shift'}
function StarTooltip({active,payload=[],label}) {
  const row=payload[0]?.payload
  const starFields=payload.length>0&&payload.every(item=>['stars','completedStars','partialStars'].includes(item.dataKey))
  const details=starFields&&Number.isFinite(row?.stars)?[{label:'Stars',value:n(row.stars)}]:payload.filter(item=>item.value!=null).map(item=>({label:String(item.name??item.dataKey).replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase()),value:n(item.value)}))
  if(row?.coverage)details.push({label:'Coverage',value:row.coverage})
  return <ChartTooltip active={active} label={row?.date?shortDate(row.date):label} details={details}/>
}
function Changed({value,children,as:Tag='div'}) {
  const previous=useRef(value)
  const [changed,setChanged]=useState(false)
  useEffect(()=>{
    if(previous.current!==value) {
      previous.current=value
      setChanged(true)
      const timer=setTimeout(()=>setChanged(false),800)
      return ()=>clearTimeout(timer)
    }
  },[value])
  return <Tag className={changed?'egm-live-changed':undefined} onAnimationEnd={()=>setChanged(false)}>{children}</Tag>
}
function Plot({id,queryId,title,rows,spec,description,sourceRows=rows,children,chartOptions}) {
  if(!rows.length)return <DataComponent {...{id,queryId,title,description}} kind="custom" variant="card" displayRows={[]} sourceRows={sourceRows}><EmptyState chart/></DataComponent>
  const brandedSpec = { ...spec, colors: spec.colors ?? {[spec.y]:'var(--chart-1)'} }
  return <Changed value={JSON.stringify(rows)}><EvidenceChart {...{id,queryId,title,rows,description,sourceRows,chartOptions}} spec={brandedSpec} variant="card" height={300}>{children}</EvidenceChart></Changed>
}
function ChannelName({row}) {
  return <span className="egm-channel-name">{row.__categoryIcon&&<img src={row.__categoryIcon} width="16" height="16" alt=""/>}{row.source}</span>
}
function ViewBar({value,max}) {
  const known=Number.isFinite(value)
  const amount=known?value:0
  const width=max>0?Math.max(0,Math.min(100,amount/max*100)):0
  return <span className="egm-view-bar"><span className="egm-view-bar-track" aria-hidden="true"><span style={{width:`${width}%`}}/></span><span className="egm-view-bar-value">{known?n(value):<span aria-label="Views unknown">—</span>}</span></span>
}
function Table({id,queryId,title,rows,columns,searchable=false,sourceRows=rows,note,pageSize}) {
  return <DataComponent {...{id,queryId,title}} kind="table" variant="card" displayRows={rows} sourceRows={sourceRows}>{rows.length?<DataTable rows={rows} columns={columns} searchable={searchable} label={title} {...(pageSize?{pageSize}:{})}/>:<EmptyState/>}{note&&<p className="egm-note">{note}</p>}</DataComponent>
}
function useVideoGrid(available) {
  const [width,setWidth]=useState(()=>globalThis.innerWidth||1280)
  useEffect(()=>{
    const update=()=>setWidth(window.innerWidth)
    update()
    window.addEventListener('resize',update)
    return ()=>window.removeEventListener('resize',update)
  },[])
  return videoGrid(available,width)
}
function AcrossEgm({queries,reach,web}) {
  const ids=['website','reach','youtube_videos','research_evidence','issue_queue','mentions'].filter(id=>queries[id])
  const sourceRowsByQuery=Object.fromEntries(ids.map(id=>[id,queries[id].rows]))
  const rankedVideos=(queries.youtube_videos?.rows??[]).filter(row=>Number.isFinite(row.views)&&row.views>=0&&/^[A-Za-z0-9_-]{11}$/.test(row.videoId??'')).sort((a,b)=>b.views-a.views)
  const grid=useVideoGrid(rankedVideos.length)
  const popularVideos=rankedVideos.slice(0,grid.count)
  const experiment=suggestExperiment(queries)
  const viewShare=ratio(web.referralViews,reach.views)
  const visitorShare=ratio(web.referralVisitors,reach.visitors)
  const displayRows=[{signal:'Website referrals',views:web?.referralViews??null,viewShare,visitorShare},...popularVideos.map(video=>({signal:'YouTube view count',url:video.url,views:video.views})),...(experiment?[{signal:'Suggested experiment',url:experiment.winner.url,score:experiment.winner.score}]:[])]
  return <DataComponent id="overview-across-egm" queryId="website" queryIds={ids} title="Highlights" kind="custom" variant="card" displayRows={displayRows} sourceRowsByQuery={sourceRowsByQuery}>
    <div className="egm-highlights" data-reviewed-rows>
      <article className="egm-highlight egm-highlight-referrals">
        <h3>egm.dev referrals</h3>
        <p className="egm-highlight-value">{viewShare!=null&&visitorShare!=null?<><strong>{percentage(viewShare)}</strong> of repo views and <strong>{percentage(visitorShare)}</strong> of unique visitors arrived from egm.dev.</>:'egm.dev was not among GitHub’s top ten referrers, so its share is unknown.'}</p>
        <a className="egm-highlight-link" href="/website">Website <Icon name="arrowUpRight" size={14}/></a>
      </article>
      <article className="egm-highlight egm-highlight-videos">
        <h3>Popular videos</h3>
        {popularVideos.length?<div className="egm-overview-videos" style={{'--video-columns':grid.columns}}>{popularVideos.map(video=>{
          const title=video.title??'YouTube video'
          return <a className="egm-overview-video" key={video.videoId} href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">
            <span className="egm-overview-video-frame"><VideoThumbnail id={video.videoId} poster="mqdefault" sizes="(max-width: 799px) 33vw, (max-width: 1279px) 25vw, 16vw" alt={`${title} preview`}/></span>
            <span className="egm-overview-video-title" title={title}>{title}</span>
            <span className="egm-overview-video-views">{compact(video.views)} views</span>
          </a>
        })}</div>:<p className="egm-highlight-value">No YouTube view counts collected yet.</p>}
        <a className="egm-highlight-link" href="/mentions">Mentions <Icon name="arrowUpRight" size={14}/></a>
      </article>
      <article className="egm-highlight egm-highlight-experiment">
        <h3>Suggested experiment</h3>
        {experiment?<><p className="egm-highlight-value">{experiment.action}</p><p className="egm-highlight-success">Success: {experiment.success}</p><ul className="egm-experiment-evidence">{experiment.evidence.map(item=><li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></li>)}</ul><details className="egm-highlight-rule"><summary>How this is picked</summary><p>{experiment.rule}</p></details></>:<p className="egm-highlight-value">No issue, verified quote, or mention is available yet.</p>}
      </article>
    </div>
  </DataComponent>
}
export function DashboardContent() {
  const {snapshot} = useDataApp()
  return <><StaleNotice generatedAt={snapshot?.generatedAt}/><DashboardTab/><CollectionStatus refreshStatus={snapshot?.refreshStatus}/></>
}
function DashboardTab() {
  const {queries,appTitle,setAppTitle} = useDataApp()
  useEffect(() => {
    if (appTitle === 'EGM performance') setAppTitle('EGM Growth Dashboard')
  }, [appTitle,setAppTitle])
  const {activeTabId} = useDashboardTabs(tabs)
  useEffect(() => { trackDashboardSection(activeTabId) }, [activeTabId])
  if(activeTabId==='research') return <Research />
  if(activeTabId==='mentions') return <Mentions />
  const rows = id => queries[id]?.rows??[]
  const reach = rows('reach')[0]??{}, daily = rows('traffic'), web = rows('website')[0]??{}, queue = rows('maintenance')[0]??{}
  const span = dateSpan(daily), window = span === 'Unavailable' ? 'GitHub’s two-week window' : `${span} UTC`
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
    const weeklyText=weeklyChangeLabel(weekly,id==='stars'?'new':'')
    const weeklyMissing=['total-views','total-clones','stars'].includes(id)&&!weeklyText&&Number.isFinite(value)
    const queryIds=[...new Set([queryId,...(field&&queries[historyQuery]?[historyQuery]:[]),...(websiteMetric?['reach']:[])])]
    const trend = {trendValues,trendLabel:websiteMetric?'Each point is the trailing 14-day referral total at that observation; points overlap':id === 'stars' ? 'Cumulative stargazers by Pacific date' : `Daily ${field}, ${window}`,queryIds,sourceRowsByQuery:Object.fromEntries(queryIds.map(key=>[key,rows(key)]))}
    return <DataComponent {...{id,queryId,title,description}} kind="metric" variant="card" queryIds={trend.queryIds} displayRows={rows(queryId)} sourceRows={rows(queryId)} sourceRowsByQuery={trend.sourceRowsByQuery}>
      <div className="egm-metric-reading" data-reviewed-rows><span className="egm-metric-value"><Changed as="span" value={value}>{n(value)}</Changed></span>{field&&trendValues.length>=2&&(!websiteMetric||new Set(trendValues).size>=2)&&<TrendSparkline values={trend.trendValues} label={trend.trendLabel} />}</div>
      {secondary&&<p className="egm-metric-secondary" data-reviewed-rows>{secondary}</p>}
      {weeklyMissing&&<p className="egm-metric-secondary" data-reviewed-rows>{id==='stars'&&historyStale?'Weekly change unavailable · stale history':'Weekly change unavailable'}</p>}
      {weeklyText&&<p className="egm-metric-secondary" data-reviewed-rows title={`Latest seven complete reported days (${weekly.mid}–${weekly.end}) compared with the preceding seven.${weekly.reconstructed?' New stars are reconstructed from current stargazers by Pacific date; removed stars are unavailable and the partial current day is excluded.':` Additive daily ${field} counts, UTC days.`}`}>{weeklyText}</p>}
    </DataComponent>
  }
  const popularPages = id => {
    const sourceRows=rows('paths')
    const pages=popularPageRows(sourceRows)
    return <Table id={id} queryId="paths" title="Popular repo pages" rows={pages} sourceRows={sourceRows} columns={pageColumns} pageSize={12} note={pages.some(row=>row.combined)?'Views for the same file at /blob/main and /blob/HEAD are combined. Unique visitors are not added, because those audiences overlap by an unknown amount.':undefined} />
  }
  const clonePlot = id => <Plot id={id} queryId="traffic" title="Daily clone activity" rows={daily} spec={{...line('clones',['clones','cloners']),legend:{labels:{clones:'Clone operations',cloners:'Unique cloners per day'}}}} description={`${window}. Clone operations include repeat and automated clones; daily unique cloners cannot be summed.`} />
  const chartHome = ({id, queryId, queryIds, title, summary, href, linkLabel, displayRows, sourceRows, sourceRowsByQuery}) => <DataComponent {...{id, queryId, queryIds, title}} kind="custom" variant="card" displayRows={displayRows} sourceRows={sourceRows} sourceRowsByQuery={sourceRowsByQuery}>
    <p className="egm-chart-home">{summary}</p>
    <a className="egm-overview-next" href={href}>{linkLabel} <Icon name="arrowUpRight" size={14}/></a>
  </DataComponent>
  const downloadsTable = id => <Table id={id} queryId="downloads" title="Release asset downloads" rows={rows('downloads')} columns={downloadColumns} />
  if(activeTabId==='acquisition') {
    const channels = combinedReferralViews(rows('referrers'))
    const attributed = sum(channels,'count')
    const searchVideoViews=sum(channels.filter(row=>isSearchVideo(row.source)),'count')
    const channelRows = channels.map(row=>({...row,shareOfRepoViews:ratio(row.count,reach.views),shareOfReportedReferrals:ratio(row.count,attributed)}))
    const maxChannel=channels[0]?.count??0
    return <>
      <PageSummary page="acquisition" queries={queries}/>
      <Section id="acquisition-channels-heading" spacing="none">
        <DataComponent id="acquisition-shares" queryId="referrers" queryIds={['referrers','reach']} title="Repo views by channel" kind="table" variant="card" displayRows={channelRows} sourceRowsByQuery={{referrers:rows('referrers'),reach:rows('reach')}}>
          {attributed>0&&reach.views>0&&<InsightCallout>Google and YouTube sent {percentage(searchVideoViews/attributed)} of the views GitHub attributes to its top ten referrers, or {percentage(searchVideoViews/reach.views)} of all repo views in {window}.</InsightCallout>}
          {!channelRows.length?<EmptyState/>:<DataTable rows={channelRows} searchable={false} pageSize={12} label="Repo views by channel" columns={[{field:'source',label:'Channel',renderCell:(value,row)=><ChannelName row={row}/>},{field:'count',label:'Views',renderCell:value=><ViewBar value={value} max={maxChannel}/>},{field:'shareOfRepoViews',label:'Share of all repo views',renderCell:v=>percentage(v)},{field:'shareOfReportedReferrals',label:'Share of top-ten referrer views',renderCell:v=>percentage(v)}]} />}
          <p className="egm-note">{referrerDescription}</p>
        </DataComponent>
      </Section>
      <Section id="acquisition-content-heading">
        {popularPages('acquisition-pages')}
      </Section>
    </>
  }
  if(activeTabId==='adoption') return <>
    <PageSummary page="adoption" queries={queries}/>
    <Section id="adoption-signals-heading" spacing="none" columns={2}>
      {metric('adoption-cloners','reach','Unique cloners',reach.cloners,`Distinct cloners GitHub counted over ${window}. Repeat clones by the same cloner count once; CI runners and fresh containers count as cloners. Summing the per-day unique cloners in the chart below will not equal this total.`)}
      {metric('adoption-clones','reach','Clone operations',reach.clones,`Times the repo was copied with Git over ${window}, including repeat copies and automated tools. This does not measure installs or active users.`)}
    </Section>
    <Section id="adoption-depth-heading" title="Clone and download signals">
      {clonePlot('adoption-clone-history')}
      {downloadsTable('adoption-release-downloads')}
      <DataComponent id="adoption-measurement-gap" queryId="traffic" queryIds={['traffic','maintenance','downloads']} title="What adoption is not yet measured" kind="custom" variant="card" displayRows={[{recentViews,windowViews,openIssues:queue.openIssues??null}]} sourceRowsByQuery={{traffic:daily,maintenance:rows('maintenance'),downloads:rows('downloads')}}>
        {windowViews>0&&recentDays.length===3&&daily.length>3&&<InsightCallout>{n(recentViews)} of the {n(windowViews)} repo views in {window} arrived {dateSpan(recentDays)} ({percentage(recentViews/windowViews)}; an even spread over {daily.length} days would be {percentage(3/daily.length)}).</InsightCallout>}
        <p className="egm-note">Clones show that code was fetched, not that EGM ran successfully or was used again. EGM is normally installed by cloning or through the Claude Code plugin command, neither of which appears in release downloads, so downloads undercount installs. Release downloads are lifetime asset counts, not limited to the traffic window; SHA256SUMS is a checksum file.</p>
      </DataComponent>
    </Section>
  </>
  if(activeTabId==='website') return <>
    <PageSummary page="website" queries={queries}/>
    <Section id="website-flow-title" spacing="none" columns={2}>
      {metric('website-visitors','website','Visitors egm.dev sent to GitHub',web?.referralVisitors,`Unique repo visitors whose referrer was egm.dev over GitHub’s rolling 14-day window. Unknown when egm.dev is outside GitHub’s top ten referrers.`,Number.isFinite(web?.referralVisitors)&&reach.visitors>0?`${percentage(web.referralVisitors/reach.visitors)} of all unique repo visitors`:undefined)}
      {metric('website-views','website','Views egm.dev sent to GitHub',web?.referralViews,`Repo views whose referrer was egm.dev over GitHub’s rolling 14-day window. Unknown when egm.dev is outside GitHub’s top ten referrers.`,Number.isFinite(web?.referralViews)&&reach.views>0?`${percentage(web.referralViews/reach.views)} of all repo views`:undefined)}
    </Section>
    <Section id="website-measurement-title" spacing="content">
      {!queries.web_pagespeed&&!queries.web_crux&&!rows('site_performance').length&&<p className="egm-note">Site performance (Lighthouse lab test and Chrome UX Report field data) is not collected yet. Collection starts once a Google web performance API key is configured for the Worker.</p>}
      {['pagespeed','crux'].map(name=>{
        const id=`web_${name}`, data=rows(id), status=rows(`${id}_status`)[0], title=name==='pagespeed'?'Lab performance (Lighthouse, simulated mobile)':'Real-user experience (Chrome UX Report)'
        const legacy=rows('site_performance').find(row=>row.kind===(name==='pagespeed'?'Lab':'Field') && row.observedAt)
        if (!queries[id] && !legacy) return null
        if (!data.length && legacy) return <DataComponent key={id} id={`website-${id}`} queryId="site_performance" title={title} kind="custom" variant="card" displayRows={[legacy]} sourceRowsByQuery={{site_performance:rows('site_performance')}}>
          <div data-reviewed-rows><p>{name==='pagespeed'?`Performance score: ${legacy.score} / 100`:`Largest Contentful Paint: ${legacy.lcp == null ? 'Unavailable' : `${legacy.lcp} ms`} · Interaction to Next Paint: ${legacy.inp == null ? 'Unavailable' : `${legacy.inp} ms`} · Cumulative Layout Shift: ${legacy.cls == null ? 'Unavailable' : legacy.cls}`}</p>
          <p className="egm-note">Previous {name==='pagespeed'?'simulated mobile test':'phone-only Chrome user data'} observed {performanceDate(legacy.observedAt)} UTC. {name==='crux' && legacy.periodStart && legacy.periodEnd ? `Period: ${legacy.periodStart}–${legacy.periodEnd}. ` : ''}A newer collection is unavailable.</p></div>
        </DataComponent>
        const due=status?.nextAttemptAt && Date.parse(status.nextAttemptAt)<Date.now()
        const ended=status?.status==='expired'||(status?.collectionEndsAt && Date.parse(status.collectionEndsAt)<=Date.now())
        const fieldRows=Object.keys(webVitals).map(metric=>data.find(row=>row.metric===metric)??{metric})
        const period=fieldRows.find(row=>row.startDate&&row.endDate)
        const displayMetric=(value,unit)=>Number.isFinite(value)?`${unit==='ms'?Math.round(value).toLocaleString('en-US'):value.toFixed(2)}${unit==='ms'?' ms':''}`:'Unavailable'
        return <DataComponent key={id} id={`website-${id}`} queryId={id} queryIds={[id,`${id}_status`].filter(key=>queries[key])} title={title} kind="custom" variant="card" displayRows={data} sourceRowsByQuery={{[id]:data,[`${id}_status`]:rows(`${id}_status`)}}>
          <div data-reviewed-rows>
            {status?.status==='stale'&&<p className="egm-note">The latest collection failed; showing the last successful result.</p>}
            {ended&&<p className="egm-note">The collection window has ended. This result will not refresh until collection is re-enabled.</p>}
            {status?.status==='available'&&due&&!ended&&<p className="egm-note">A refresh is due on the next scheduled run.</p>}
            {!data.length?<p>Unavailable{status?.reason?` (${status.reason.replaceAll('_',' ')})`:'.'}</p>:name==='pagespeed'?<><p>Performance score: {data[0].score} / 100</p><p>Largest Contentful Paint: {displayMetric(data[0].lcpMs,'ms')} · Cumulative Layout Shift: {displayMetric(data[0].cls)} · Total Blocking Time: {displayMetric(data[0].totalBlockingTimeMs,'ms')}</p><p className="egm-note">PageSpeed Insights simulated mobile test of the egm.dev home page, {performanceDate(data[0].fetchedAt)} UTC. Results vary between runs.</p></>:<><p>{fieldRows.map(row=>`${webVitals[row.metric]}: ${displayMetric(row.p75,row.metric==='cumulative_layout_shift'?null:'ms')}`).join(' · ')}</p><p>{fieldRows.map(row=>`${webVitals[row.metric]} rated good: ${Number.isFinite(row.goodFraction)?percentage(row.goodFraction):'Unavailable'}`).join(' · ')}</p><p className="egm-note">75th percentile across real Chrome users of the egm.dev origin, all device types. {period?`${performanceDate(period.startDate)}–${performanceDate(period.endDate)}.`:'Collection period unavailable.'}</p></>}
          </div>
        </DataComponent>
      })}
      <DataComponent id="website-measurement" queryId="website_contribution" queryIds={['website_contribution','website','reach']} title="Referral contribution" kind="custom" displayRows={rows('website_contribution')} sourceRowsByQuery={{website_contribution:rows('website_contribution'),website:rows('website'),reach:rows('reach')}} variant="card">
        {(()=>{const contribution=rows('website_contribution')[0];return Number.isFinite(contribution?.rank)&&contribution.rank>0?<InsightCallout>egm.dev ranks #{contribution.rank} among GitHub’s top ten referrers and accounts for {percentage(contribution.topTenShare)} of the views attributed to them.</InsightCallout>:<InsightCallout>egm.dev is not among GitHub’s top ten referrers for {window}, so its rank and share are unknown.</InsightCallout>})()}
        <p className="egm-note">Referral views measure arrivals at the GitHub repo from egm.dev, not website visits or conversion. Total egm.dev visitor counts are not collected.</p>
      </DataComponent>
      {chartHome({id:'website-referrals',queryId:'referrers',title:'Views by referring source',summary:combinedReferralViews(rows('referrers'))[0]?`${combinedReferralViews(rows('referrers'))[0].source} leads recorded referrals with ${n(combinedReferralViews(rows('referrers'))[0].count)} repo views.`:'No referring sources are recorded for this window.',href:'/acquisition',linkLabel:'Acquisition',displayRows:combinedReferralViews(rows('referrers')),sourceRows:rows('referrers')})}
    </Section>
  </>
  if(activeTabId==='development') return <>
    <PageSummary page="development" queries={queries}/>
    <Section id="development-summary" spacing="none">
    <SortableRegion id="development:canvas" variant="freeform" className="egm-dashboard-grid egm-development-grid" authoredRevision={3} rows={[
      {id:'dev:metrics',kind:'metrics',items:['open-issues','open-prs','merged-prs']},
      {id:'dev:activity',items:['pr-activity','issue-activity']},
      {id:'dev:queue',items:['issue-queue']}
    ]}>
      {item('open-issues',4,metric('open-issues','maintenance','Open issues',queue.openIssues,'Current count at the last refresh, not limited to the traffic window.'),'metric')}
      {item('open-prs',4,metric('open-prs','maintenance','Open PRs',queue.openPRs,`Current count at the last refresh, including ${n(queue.draftPRs)} draft PRs.`),'metric')}
      {item('merged-prs',4,metric('merged-prs','activity','Merged PRs',rows('activity').length ? sum(rows('activity'),'mergedPRs') : null,dateSpan(rows('activity'))),'metric')}
      {item('pr-activity',6,<Plot id="pr-activity" queryId="activity" title="Daily merged PRs" rows={rows('activity')} spec={{...line('mergedPRs'),type:'bar'}} description={`${dateSpan(rows('activity'))} UTC.`} />)}
      {item('issue-activity',6,<Plot id="issue-activity" queryId="activity" title="Daily issue activity" rows={rows('activity')} spec={{...line('openedIssues',['openedIssues','closedIssues']),colors:{openedIssues:'var(--chart-1)',closedIssues:'var(--chart-4)'},legend:{labels:{openedIssues:'Opened issues',closedIssues:'Closed issues'}}}} description={`${dateSpan(rows('activity'))} UTC.`} />)}
      {item('issue-queue',12,<Table id="issue-queue" queryId="issue_queue" title="Open issues by discussion volume" rows={rows('issue_queue')} searchable columns={[{field:'number',label:'#'},{field:'title',label:'Issue',renderCell:(v,r)=>safeExternalUrl(r.url)?<a href={safeExternalUrl(r.url)} target="_blank" rel="noreferrer">{v}</a>:v},{field:'comments',label:'Comments'}]} />,'table')}
    </SortableRegion>
    </Section>
    <p className="egm-note">Comment counts show how much an issue is discussed, not its severity. Release downloads are on the Adoption tab.</p>
  </>
  const starHistory=rows('star_history')
  const historyObservedAt=queries.star_history?.source?.executedAt
  const observedPacificDate=historyObservedAt&&Number.isFinite(Date.parse(historyObservedAt))?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(historyObservedAt)):null
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
      {item('unique-visitors',3,metric('unique-visitors','reach','Unique visitors',reach.visitors,`Distinct repo visitors GitHub counted over ${window}. Repeat visits by the same visitor count once, so the per-day unique counts in the chart below do not add up to this total.`,daily.length?`${span} · deduplicated`:'Deduplicated'),'metric')}
      {item('total-views',3,metric('total-views','reach','Repo views',reach.views,`GitHub repo page views, including repeat visits, over ${window}.`),'metric')}
      {item('total-clones',3,metric('total-clones','reach','Clone operations',reach.clones,`Times the repo was copied with Git over ${window}, including repeat copies and automated tools. GitHub counted ${n(reach.cloners)} distinct cloners.`),'metric')}
      {item('stars',3,metric('stars','reach','Total stars',reach.stars,`GitHub accounts starring the repo at the last refresh. This is a snapshot total, not stars gained during the traffic window. ${n(reach.forks)} forks; ${n(reach.watchers)} watching.`),'metric')}
      {item('overview-across-egm',12,<AcrossEgm {...{queries,reach,web}}/>,'custom')}
      {item('visitor-trend',6,<Plot id="visitor-trend" queryId="traffic" title="Daily views and unique visitors" rows={daily} spec={{...line('views',['views','visitors']),legend:{labels:{views:'Views',visitors:'Unique visitors per day'}}}} description={`${window}. GitHub reports each day separately; daily unique visitors cannot be summed.`} />)}
      {item('clone-trend',6,chartHome({id:'clone-trend',queryId:'traffic',title:'Daily clone activity',summary:`${n(reach.clones)} clone operations from ${n(reach.cloners)} unique cloners in ${window}.`,href:'/adoption',linkLabel:'Adoption',displayRows:daily,sourceRows:daily}))}
      {item('star-history',12,<Plot id="star-history" queryId="star_history" title="Star accumulation" rows={starDisplayRows} sourceRows={starHistory} spec={starSpec} chartOptions={{tooltipContent:<StarTooltip/>}}><p className="egm-note">Cumulative stars by Pacific date, reconstructed from current stargazers; stars removed before collection are unavailable.{partialStarDay?' The faded final segment is the partial current day.':''}</p></Plot>)}
      {item('referral-chart',6,chartHome({id:'referral-chart',queryId:'referrers',queryIds:['referrers','reach'],title:'Top referring sources by repo views',summary:combinedReferralViews(rows('referrers'))[0]?`${combinedReferralViews(rows('referrers'))[0].source} leads with ${n(combinedReferralViews(rows('referrers'))[0].count)} repo views.`:'No referring sources are recorded for this window.',href:'/acquisition',linkLabel:'Acquisition',displayRows:combinedReferralViews(rows('referrers')),sourceRowsByQuery:{referrers:rows('referrers'),reach:rows('reach')}}))}
      {item('popular-paths',6,chartHome({id:'popular-paths',queryId:'paths',title:'Popular repo pages',summary:popularPageRows(rows('paths'))[0]?`${pathLabel(popularPageRows(rows('paths'))[0].path)} has ${n(popularPageRows(rows('paths'))[0].count)} views.`:'No popular pages are recorded for this window.',href:'/acquisition',linkLabel:'Acquisition',displayRows:popularPageRows(rows('paths')),sourceRows:rows('paths')}))}
    </SortableRegion>
  </>
}
