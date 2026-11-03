import {percentage} from './percentage.mjs'
import {dateSpan, ratio} from './metric-safety.mjs'
import {safeExternalUrl} from './research-mentions.mjs'
import React, { useEffect, useRef, useState } from 'react'
import { ChartTooltip, DataComponent, DataTable, EvidenceChart, Hint, Icon, Section, SegmentedControl, SortableItem, SortableRegion, useDataApp, useDashboardTabs } from '../../data-app-public.jsx'
import './egm.css'
import {Research} from './Research.jsx'
import {TrendSparkline} from './TrendSparkline.jsx'
import {Mentions} from './Mentions.jsx'
import {pathLabel, popularPageRows, repoPathHref} from './repo-paths.mjs'
import {sourceIcon} from './source-icon.mjs'
import {weeklyChange,starWeeklyChange,observedStarChange,weeklyChangeLabel,weeklyDelta} from './weekly-change.mjs'
import {channelViews,isSearchVideo} from './referrer-channels.mjs'
import {InsightCallout} from './InsightCallout.jsx'
import {OverviewSummary} from './OverviewSummary.jsx'
import {PageSummary} from './PageSummary.jsx'
import {VideoThumbnail} from './VideoThumbnail.jsx'
import {EngagementSignals} from './EngagementSignals.jsx'
import {trackDashboardSection} from './usage-analytics.js'
import {EmptyState,StaleNotice} from './DataStates.jsx'
import {formatObservedAt} from './collection-status.mjs'
import {count} from './states.mjs'
import {suggestExperiment} from './suggested-experiment.mjs'
import {videoGrid} from './video-grid.mjs'
import {PageLink} from './PageLink.jsx'
import {SiteFooter} from './PageFooter.jsx'
import {starGrowth,observedStarGrowth,hasObservedDailyChange} from './star-growth.mjs'
import {Welcome} from './Welcome.jsx'
import {analysisSummary,savedAnalysis,audienceSentiment} from './saved-analysis.mjs'
import {AnalysisLabel,AnalysisText} from './SavedAnalysis.jsx'
import {overviewSummary,trafficCoverageNote} from './overview-summary.mjs'
import {pageSummary} from './page-summary.mjs'
import {alignedTrendValues,sampledTrendValues,dailySnapshotValues,chartDates} from './metric-trend.mjs'

const tabs = [{id:'reach',label:'Overview',previousLabels:['Reach'],filterIds:[]},{id:'acquisition',label:'Acquisition',filterIds:[]},{id:'adoption',label:'Adoption',filterIds:[]},{id:'website',label:'Website',previousLabels:['egm.dev'],filterIds:[]},{id:'development',label:'Development',filterIds:[]},{id:'research',label:'Research',filterIds:[]},{id:'mentions',label:'Mentions',filterIds:[]}]
const n = count
const compact = value => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value)
const metricNumber=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:value>=20000?0:1}).format(value).replace('K','k'):'—'
const shortDate = date => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))
const performanceDate = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : 'Unavailable'
const sum = (rows, field) => rows.reduce((a,r) => a+r[field],0)
const line = (y,fields=[y]) => ({type:'line',x:'date',y,fields,colors:Object.fromEntries(fields.map((field,index)=>[field,index%2?'var(--chart-4)':'var(--chart-1)'])),stackable:false,showXAxisLabel:false,showYAxisLabel:false,valueDecimals:0,startAtZero:true})
const pageLink = (value, row) => {
  const label = pathLabel(value)
  const href = repoPathHref(value)
  if (!href) return label
  return <Hint as="a" href={href} target="_blank" rel="noreferrer" title={row?.combined ? 'Opens the main URL. Views also include the HEAD URL.' : undefined}>{label}</Hint>
}
const combinedReferralViews = rows => channelViews(rows).map(row=>({...row,__categoryIcon:sourceIcon(row.source)}))
const referrerDescription = 'GitHub reports only its top ten referring sources, grouped here by channel (LinkedIn web and Android combined). Traffic outside the top ten is unattributed. Unique visitors cannot be deduplicated across sources.'
const pageColumns = [{field:'path',label:'Page',renderCell:pageLink},{field:'count',label:'Views'},{field:'uniques',label:'Unique visitors',renderCell:(value,row)=>row?.combined?<Hint title="Unique visitors overlap across the main and HEAD URLs and are not added." aria-label="Unique visitors unknown">—</Hint>:n(value)}]
const downloadColumns = [{field:'release',label:'Release'},{field:'asset',label:'Asset'},{field:'downloads',label:'Downloads'}]
const webVitals = {largest_contentful_paint:'Largest Contentful Paint',interaction_to_next_paint:'Interaction to Next Paint',cumulative_layout_shift:'Cumulative Layout Shift'}
function StarTooltip({active,payload=[],label}) {
  const row=payload[0]?.payload
  const starFields=payload.length>0&&payload.every(item=>['stars','completedStars','partialTotal'].includes(item.dataKey))
  const details=starFields&&Number.isFinite(row?.stars)?[{label:'Stars',value:n(row.stars)}]:payload.filter(item=>item.value!=null).map(item=>({label:['newStars','partialStars'].includes(item.dataKey)?'New stars':String(item.name??item.dataKey).replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase()),value:n(item.value)}))
  if(row?.coverage)details.push({label:'Coverage',value:row.coverage})
  if(row?.observedAt)details.push({label:'Observed at',value:formatObservedAt(row.observedAt)})
  if(row?.fromObservedAt)details.push({label:'Since',value:formatObservedAt(row.fromObservedAt)})
  return <ChartTooltip active={active} label={row?.date?shortDate(row.date):label} details={details}/>
}
export function StarGrowth({rows,observedAt,stale,observations,reportDates}) {
  const [measure,setMeasure]=useState('daily')
  const [range,setRange]=useState('recent')
  const [basis,setBasis]=useState('auto')
  const hasObserved=Boolean(observations?.rows?.length)
  const observed=hasObserved&&(basis==='observed'||(basis==='auto'&&stale&&(!rows.length||hasObservedDailyChange(observations.rows,observations.source?.executedAt))))
  const growth=observed?observedStarGrowth(observations.rows,observations.source?.executedAt):starGrowth(rows,observedAt)
  const byDate=new Map(growth.daily.map(row=>[row.date,row]))
  const selected=range==='recent'?(reportDates?.length?reportDates.map(date=>byDate.get(date)??{date,stars:null,coverage:'Not available'}):growth.recent):growth.daily
  const displayRows=observed?selected:selected.map((row,index)=>({...row,
    completedStars:row.coverage==='Complete day'?row.stars:null,
    partialTotal:row.coverage==='Partial day'||selected[index+1]?.coverage==='Partial day'?row.stars:null
  }))
  const hasNet=selected.some(row=>Number.isFinite(row.netStars)||Number.isFinite(row.partialNetStars))
  const daily=measure==='daily'&&(!observed||hasNet)
  const weekly=observed?observedStarChange(observations.rows,observations.source?.executedAt):starWeeklyChange(rows,observedAt)
  const fields=observed?(daily?['netStars','partialNetStars']:['stars']):daily?['newStars','partialStars']:['completedStars','partialTotal']
  const spec={...line(fields[0],fields),type:daily?'stackedBar':'line',rightAxisFields:[],showLegend:false,colors:Object.fromEntries(fields.map((field,index)=>[field,index?'color-mix(in srgb, var(--chart-1) 40%, transparent)':'var(--chart-1)']))}
  const controls=<>{hasObserved&&<SegmentedControl ariaLabel="Star measurement" value={observed?'observed':'reconstructed'} onChange={setBasis} options={[{value:'reconstructed',label:'Reconstructed history'},{value:'observed',label:'Observed totals'}]}/>}<SegmentedControl ariaLabel="Star measure" value={daily?'daily':'total'} onChange={setMeasure} options={[{value:'daily',label:observed?'Net change':'Daily gains',disabled:observed&&!hasNet},{value:'total',label:observed?'Total':'Cumulative'}]}/><SegmentedControl ariaLabel="Star history range" value={range} onChange={setRange} options={[{value:'recent',label:reportDates?.length?dateSpan(reportDates.map(date=>({date}))):'Latest 14 days'},{value:'all',label:'Full history'}]}/></>
  return <EvidenceChart id="star-history" className="egm-time-series" queryId={observed?'star_observations':'star_history'} title={observed?(daily?'Observed net star change':'Observed star totals'):daily?'Daily new stars':'Star accumulation'} rows={displayRows} sourceRows={observed?observations.rows:rows} spec={spec} variant="card" height={300} headerControls={controls} chartOptions={{fixedAxisWidths:true,tooltipContent:<StarTooltip/>}}>
    {!observed&&stale&&<p className="egm-note" role="status"><strong>Star history is out of date.</strong> History was collected {formatObservedAt(observedAt)??'at an unknown time'}. The total stars metric may be newer.</p>}
    {reportDates?.length&&range==='recent'&&<p className="egm-note">Through today. Faded marks indicate the partial day; dates without observations are blank. Star history uses Pacific days; traffic uses UTC days.</p>}
    <details className="egm-chart-notes"><summary>How to read this chart</summary>
    {weekly&&<p className="egm-note">{observed?`${n(weekly.current)} net stars across the latest seven daily-snapshot intervals, versus ${n(weekly.previous)} in the preceding seven. Actual bounds: ${formatObservedAt(weekly.startObservedAt)} → ${formatObservedAt(weekly.midObservedAt)} → ${formatObservedAt(weekly.endObservedAt)}.`:<><strong>{weekly.current>weekly.previous?'More':weekly.current<weekly.previous?'Fewer':'The same number of'} new stars in the most recent complete week{stale?' in this history':''}.</strong> {n(weekly.current)} during {shortDate(weekly.mid)} – {shortDate(weekly.end)}, versus {n(weekly.previous)} in the preceding seven days. {weekly.previous<100?'The earlier baseline is small; a percentage would overstate the comparison.':''}</>}</p>}
    <p className="egm-note">{range==='recent'&&growth.hiddenDays>0?`${growth.hiddenDays} earlier dates are outside this view; full history remains available. `:''}{observed?'Latest observed repository totals per Pacific date, not exact midnight totals. Net change can be negative; faded marks show the partial sampling date. Missing sampling dates are unknown, not zero.':'Pacific dates; faded marks show the incomplete day. Daily gains are reconstructed from current stargazers, excluding stars removed before collection. Gaps are unknown, not zero.'}</p>
    {observed&&!weekly&&<p className="egm-note">Comparison needs 15 consecutive closed sampling dates. Reconstructed history remains available separately.</p>}
    <p className="egm-note">Stars measure attention. Sustained adoption needs repeat usage or retention evidence; clones and downloads alone cannot establish it.</p>
    </details>
  </EvidenceChart>
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
  const latest=queryId==='traffic'?rows.map(row=>row.date).filter(Boolean).sort().at(-1):null
  return <Changed value={JSON.stringify(rows)}><EvidenceChart {...{id,queryId,title,rows,description,sourceRows}} className="egm-time-series" chartOptions={{fixedAxisWidths:true,...chartOptions}} spec={brandedSpec} variant="card" height={300}>{latest&&<p className="egm-note">Data through {shortDate(latest)} (UTC).{latest===new Date().toISOString().slice(0,10)?' Today is incomplete.':''}</p>}{children}</EvidenceChart></Changed>
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
function AcrossEgm({queries}) {
  const sentiment=audienceSentiment(queries)
  const saved=savedAnalysis(queries,'overview_experiment')
  const analysis=saved&&!saved.stale?saved:null
  const ids=[...new Set([...['referrers','paths','youtube_videos','youtube_comments','research_evidence','issue_queue'].filter(id=>queries[id]),...(analysis?['daily_analysis',...analysis.evidenceQueryIds]:[]),...(sentiment.analysis?['daily_analysis',...sentiment.analysis.evidenceQueryIds]:[])])]
  const sourceRowsByQuery=Object.fromEntries(ids.map(id=>[id,queries[id].rows]))
  const rankedVideos=(queries.youtube_videos?.rows??[]).filter(row=>Number.isFinite(row.views)&&row.views>=0&&/^[A-Za-z0-9_-]{11}$/.test(row.videoId??'')).sort((a,b)=>b.views-a.views)
  const grid=useVideoGrid(rankedVideos.length)
  const popularVideos=rankedVideos.slice(0,grid.count)
  const experiment=analysis?null:suggestExperiment(queries)
  const displayRows=[...popularVideos.map(video=>({signal:'YouTube view count',url:video.url,views:video.views})),...(experiment?[{signal:'Suggested experiment',url:experiment.winner.url,category:experiment.category}]:[])]
  return <DataComponent id="overview-across-egm" queryId={ids[0]} queryIds={ids} title="Highlights" kind="custom" variant="card" displayRows={displayRows} sourceRowsByQuery={sourceRowsByQuery}>
    <div className="egm-highlights" data-reviewed-rows>
      <article className="egm-highlight egm-highlight-sentiment">
        <h3>Audience sentiment</h3>
        <p className="egm-highlight-value">{sentiment.analysis?.headline??'Not yet assessed.'}</p>
        {sentiment.analysis&&<><p>{sentiment.analysis.summary}</p><AnalysisLabel analysis={sentiment.analysis}/></>}
        <p className="egm-note">{sentiment.comments?`${sentiment.comments} collected comments across ${sentiment.videos} ${sentiment.videos===1?'video':'videos'}. Selected sample, not overall audience opinion.`:'No comment sample collected yet.'}{!sentiment.analysis&&sentiment.comments>0?' A current Gemini assessment is not available yet.':''}</p>
        <PageLink className="egm-highlight-link" page="mentions">Read collected comments <Icon name="arrowUpRight" size={14}/></PageLink>
      </article>
      <article className="egm-highlight egm-highlight-videos">
        <h3>Popular videos</h3>
        {popularVideos.length?<div className="egm-overview-videos" style={{'--video-columns':grid.columns}}>{popularVideos.map(video=>{
          const title=video.title??'YouTube video'
          return <a className="egm-overview-video" key={video.videoId} href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">
            <span className="egm-overview-video-frame"><VideoThumbnail id={video.videoId} poster="mqdefault" sizes="(max-width: 799px) 33vw, (max-width: 1279px) 25vw, 16vw" alt={`${title} preview`}/></span>
            <Hint className="egm-overview-video-title" title={title}>{title}</Hint>
            <span className="egm-overview-video-views"><EngagementSignals row={video}/></span>
          </a>
        })}</div>:<p className="egm-highlight-value">No YouTube view counts collected yet.</p>}
        <PageLink className="egm-highlight-link" page="mentions">Mentions <Icon name="arrowUpRight" size={14}/></PageLink>
      </article>
      <article className="egm-highlight egm-highlight-experiment">
        <h3>Suggested experiment</h3>
        {analysis?<AnalysisText analysis={analysis}/>:<>{experiment?<><div className="egm-experiment-plan"><div><h4>{experiment.category==='first-use'?'Find the first-use blocker':experiment.category==='docs'?'Test the path through the docs':'Test one distribution channel'}</h4><p className="egm-highlight-value">{experiment.action}</p><p className="egm-highlight-success"><strong>Measure</strong>{experiment.success}</p></div><div className="egm-experiment-basis"><h4>Why this test</h4><ul className="egm-experiment-evidence">{experiment.evidence.map(item=><li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></li>)}</ul><details className="egm-highlight-rule"><summary>How this is picked</summary><AnalysisLabel/><p>{experiment.rule}</p></details></div></div></>:<p className="egm-highlight-value">No specific first-use, documentation, or recorded-channel evidence supports an experiment yet.</p>}</>}
      </article>
    </div>
  </DataComponent>
}
export function DashboardContent() {
  const {snapshot} = useDataApp()
  return <><StaleNotice generatedAt={snapshot?.generatedAt}/><DashboardTab/></>
}
function DashboardTab() {
  const {appTitle,setAppTitle,queries,snapshot} = useDataApp()
  useEffect(() => {
    if (appTitle === 'EGM performance') setAppTitle('EGM Growth Dashboard')
  }, [appTitle,setAppTitle])
  const {activeTabId} = useDashboardTabs(tabs)
  useEffect(() => { trackDashboardSection(activeTabId) }, [activeTabId])
  const summary=analysisSummary(activeTabId==='reach'?overviewSummary(queries):pageSummary(activeTabId,queries),queries,activeTabId==='reach'?'overview':activeTabId)
  return <><TabPage activeTabId={activeTabId}/>{summary&&<section id="page-notes" className="egm-page-notes" aria-labelledby="page-notes-heading"><h2 id="page-notes-heading">Notes</h2><ol>{summary.notes?.map((note,index)=><li key={index}>{note}</li>)}{summary.range&&<li>Reporting period: {summary.range.label} {summary.range.note}. {trafficCoverageNote(queries)}</li>}</ol><details className="egm-analysis-method"><summary>Analysis method</summary><AnalysisLabel analysis={summary.analysis??summary.previousAnalysis}/>{summary.analysis?.unknowns.length>0&&<p>Unknown: {summary.analysis.unknowns.join(' ')}</p>}</details></section>}<SiteFooter generatedAt={snapshot?.generatedAt} refreshStatus={snapshot?.refreshStatus}/></>
}
function TabPage({activeTabId}) {
  const {queries} = useDataApp()
  if(activeTabId==='research') return <Research />
  if(activeTabId==='mentions') return <Mentions />
  const rows = id => queries[id]?.rows??[]
  const reach = rows('reach')[0]??{}, daily = rows('traffic'), web = rows('website')[0]??{}, queue = rows('maintenance')[0]??{}
  const reportDates=chartDates(daily)
  const dailyByDate=new Map(daily.map(row=>[row.date,row]))
  const trafficDates=reportDates.slice(0,reportDates.findLastIndex(date=>dailyByDate.has(date))+1)
  const plotDaily=trafficDates.map(date=>dailyByDate.get(date)??{date,views:null,visitors:null,clones:null,cloners:null})
  const span = dateSpan(daily), window = span === 'Unavailable' ? 'GitHub’s two-week window' : `${span} UTC`
  const chartSpan=dateSpan(reportDates.map(date=>({date})))
  const item = (id,span,content,kind='chart') => <SortableItem key={id} id={id} label={id} kind={kind} className={`egm-block egm-block--${kind}`} style={{'--egm-span':span}}>{content}</SortableItem>
  const metric = (id,queryId,title,value,description,secondary) => {
    const field = {'unique-visitors':'visitors','total-views':'views','total-clones':'clones','adoption-clones':'clones','adoption-cloners':'cloners','merged-prs':'mergedPRs','open-issues':'openIssues','open-prs':'openPRs',stars:'stars','website-visitors':'referralVisitors','website-views':'referralViews'}[id]
    const fieldNoun = {cloners:'unique cloners',mergedPRs:'merged PRs'}[field]??field
    const websiteMetric=id.startsWith('website-')
    const queueMetric=['open-issues','open-prs'].includes(id)
    const historyStale=(queries.star_history?.source?.caveats??[]).some(note=>note.startsWith('Star history is stale:'))
    const observedHistory=id==='stars'&&historyStale&&rows('star_observations').length>0&&(!rows('star_history').length||hasObservedDailyChange(rows('star_observations'),queries.star_observations?.source?.executedAt))
    const historyQuery=queueMetric?'maintenance_history':websiteMetric?'website_referral_history':id==='stars'?(observedHistory?'star_observations':'star_history'):id==='merged-prs'?'activity':'traffic'
    const history=rows(historyQuery)
    const trendValues=!field?[]:queueMetric?sampledTrendValues(history,field):websiteMetric?dailySnapshotValues(history,field):alignedTrendValues(history,field,reportDates)
    const additiveWeekly=['total-views','total-clones','adoption-clones','merged-prs'].includes(id)
    const weekly=additiveWeekly?weeklyChange(history,field):observedHistory?observedStarChange(history,queries.star_observations?.source?.executedAt):id==='stars'&&!historyStale?starWeeklyChange(history,queries.star_history?.source?.executedAt):null
    const weeklyText=weekly?.observed?`${n(weekly.current)} net · ${n(weekly.previous)} prior seven snapshot intervals`:weeklyChangeLabel(weekly,id==='stars'?'new':'')
    const delta=weeklyDelta(weekly)
    const weeklyMissing=(additiveWeekly||id==='stars')&&!weeklyText&&Number.isFinite(value)
    const queryIds=[...new Set([queryId,...(field&&queries[historyQuery]?[historyQuery]:[]),...(websiteMetric?['reach']:[])])]
    const trend = {trendValues,trendLabel:queueMetric?`Observed queue totals, ${dateSpan(history)}, Pacific sampling dates; gaps are unknown`:websiteMetric?'Each point is the trailing 14-day referral total at that observation; points overlap':id==='stars'?`${chartSpan}, Pacific dates. ${observedHistory?'Observed repository totals; missing samples break the line':'Reconstructed cumulative stargazers'}. Traffic uses UTC dates. ${historyStale?'Reconstruction is out of date; current total is newer.':''}`:`Daily ${fieldNoun}, ${chartSpan} UTC. Data available ${span}; missing dates are blank.`,queryIds,sourceRowsByQuery:Object.fromEntries(queryIds.map(key=>[key,rows(key)]))}
    return <DataComponent {...{id,queryId,title,description}} kind="metric" variant="card" queryIds={trend.queryIds} displayRows={rows(queryId)} sourceRows={rows(queryId)} sourceRowsByQuery={trend.sourceRowsByQuery}>
      <div className="egm-metric-reading" data-reviewed-rows><Hint className="egm-metric-value" title={`${n(value)} ${title.toLowerCase()}`}><Changed as="span" value={value}>{metricNumber(value)}</Changed></Hint>{field&&trendValues.filter(Number.isFinite).length>=2&&(!websiteMetric||new Set(trendValues).size>=2)&&<TrendSparkline values={trend.trendValues} label={trend.trendLabel} />}</div>
      <Hint as="p" className="egm-metric-secondary egm-metric-weekly" data-reviewed-rows title={[description,trend.trendLabel,secondary,weeklyText,weekly?`Comparison: ${weekly.mid}–${weekly.end} versus the preceding seven days.`:null,weekly?.observed?`Actual observation bounds: ${formatObservedAt(weekly.startObservedAt)} → ${formatObservedAt(weekly.midObservedAt)} → ${formatObservedAt(weekly.endObservedAt)}.`:null,weeklyMissing?'Weekly comparison unavailable; coverage is incomplete.':null].filter(Boolean).join(' ')}><span>{id==='stars'?'Lifetime':queueMetric?history.length>=2?'Observed daily':'Current total':websiteMetric?'14-day referrals':span}</span>{delta&&<span className={`egm-delta egm-delta--${delta.direction}`}>{delta.direction!=='flat'&&<Icon name={delta.direction==='up'?'arrowUp':'arrowDown'} size={12}/>}{delta.text.replace(/\d[\d,]{3,}/,value=>metricNumber(Number(value.replaceAll(',',''))))}<span className="visually-hidden">{weekly.observed?' compared with prior seven snapshot intervals':' week over week'}</span></span>}</Hint>
    </DataComponent>
  }
  const popularPages = id => {
    const sourceRows=rows('paths')
    const pages=popularPageRows(sourceRows)
    return <Table id={id} queryId="paths" title="Popular repo pages" rows={pages} sourceRows={sourceRows} columns={pageColumns} pageSize={12} note={pages.some(row=>row.combined)?'Views for the same file at /blob/main and /blob/HEAD are combined. Unique visitors are not added, because those audiences overlap by an unknown amount.':undefined} />
  }
  const clonePlot = id => <Plot id={id} queryId="traffic" title="Daily clone activity" rows={plotDaily} sourceRows={daily} spec={{...line('clones',['clones','cloners']),legend:{labels:{clones:'Clone operations',cloners:'Unique cloners per day'}}}} description={`${window}. Missing dates are blank. Clone operations include repeat and automated clones; daily unique cloners cannot be summed.`} />
  const chartHome = ({id, queryId, queryIds, title, summary, page, linkLabel, displayRows, sourceRows, sourceRowsByQuery,ranked=false}) => <DataComponent {...{id, queryId, queryIds, title}} kind="custom" variant="card" displayRows={displayRows} sourceRows={sourceRows} sourceRowsByQuery={sourceRowsByQuery}>
    {ranked&&displayRows.length?<><div className="egm-ranking-heading"><span>{queryId==='paths'?'Page':'Source'}</span><span>Repo views</span></div><ol className="egm-ranking" data-reviewed-rows>{displayRows.filter(row=>Number.isFinite(row.count)&&row.count>=0).slice(0,5).map(row=><li key={row.source??row.path}><div><span>{row.source??pageLink(row.path,row)}</span><strong>{n(row.count)}</strong></div><span className="egm-ranking-track" aria-hidden="true"><span style={{width:`${displayRows[0].count>0?row.count/displayRows[0].count*100:0}%`}}/></span></li>)}</ol><p className="egm-note">{queryId==='paths'?'Most-viewed reported pages. Repeat views are included; combined main and HEAD paths share one row.':'Top five channels from GitHub’s reported referrers. Traffic outside the reported top ten is unattributed.'}</p></>:<p className="egm-chart-home">{summary}</p>}
    <PageLink className="egm-overview-next" page={page}>{linkLabel} <Icon name="arrowUpRight" size={14}/></PageLink>
  </DataComponent>
  const downloadsTable = id => <Table id={id} queryId="downloads" title="Runtime package downloads" rows={rows('downloads').filter(row=>/^egm-(?:claude|openai)-.+\.zip$/i.test(row.asset??''))} sourceRows={rows('downloads')} columns={downloadColumns} note="Lifetime release-package downloads, not installs or successful runs. Checksum files remain in the source data." />
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
    <DataComponent id="adoption-measurement-gap" queryId="traffic" queryIds={['traffic','downloads']} title="First use and repeat use" kind="custom" variant="card" displayRows={daily} sourceRowsByQuery={{traffic:daily,downloads:rows('downloads')}}>
      <dl className="egm-adoption-gaps"><div><dt>First successful workflow</dt><dd>Not measured</dd></div><div><dt>Repeat use after seven days</dt><dd>Not measured</dd></div></dl>
      <p className="egm-note">Next check: observe five new users following the existing installation and first-workflow instructions without help. Record completion and where each person stops, then check whether they use EGM again after seven days.</p>
      <p className="egm-note">Clone operations and package downloads show code access. They do not establish successful installation, activation, or retention.</p>
    </DataComponent>
    <Section id="adoption-signals-heading" columns={2}>
      {metric('adoption-cloners','reach','Unique cloners',reach.cloners,`Distinct cloners GitHub counted over ${window}. Repeat clones by the same cloner count once; CI runners and fresh containers count as cloners. Summing the per-day unique cloners in the chart below will not equal this total.`)}
      {metric('adoption-clones','reach','Clone operations',reach.clones,`Times the repo was copied with Git over ${window}, including repeat copies and automated tools. This does not measure installs or active users.`)}
    </Section>
    <Section id="adoption-depth-heading" title="Code access and package downloads">
      {clonePlot('adoption-clone-history')}
      {downloadsTable('adoption-release-downloads')}
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
            {!data.length?<p>Unavailable{status?.reason?` (${status.reason.replaceAll('_',' ')})`:'.'}</p>:name==='pagespeed'?<><div className="egm-performance-reading"><div className="egm-performance-score"><span>Performance score</span><strong>{data[0].score}<small> / 100</small></strong><meter min="0" max="100" value={data[0].score} aria-label="Lighthouse performance score"/></div><dl className="egm-vitals">{[['Largest Contentful Paint',data[0].lcpMs,'ms'],['Cumulative Layout Shift',data[0].cls],['Total Blocking Time',data[0].totalBlockingTimeMs,'ms']].map(([label,value,unit])=><div key={label}><dt>{label}</dt><dd>{displayMetric(value,unit)}</dd></div>)}</dl></div><p className="egm-note">PageSpeed Insights simulated mobile test of the egm.dev home page, {performanceDate(data[0].fetchedAt)} UTC. Results vary between runs.</p></>:<><dl className="egm-vitals egm-vitals--field">{fieldRows.map(row=><div key={row.metric}><dt>{webVitals[row.metric]}</dt><dd>{displayMetric(row.p75,row.metric==='cumulative_layout_shift'?null:'ms')}</dd><p>{Number.isFinite(row.goodFraction)?`${percentage(row.goodFraction)} of observations rated good`:'Rating unavailable'}</p>{Number.isFinite(row.goodFraction)&&<meter min="0" max="1" value={row.goodFraction} aria-label={`${webVitals[row.metric]} fraction rated good`}/>}</div>)}</dl><p className="egm-note">75th percentile across real Chrome users of the egm.dev origin, all device types. {period?`${performanceDate(period.startDate)}–${performanceDate(period.endDate)}.`:'Collection period unavailable.'}</p></>}
          </div>
        </DataComponent>
      })}
      <DataComponent id="website-measurement" queryId="website_contribution" queryIds={['website_contribution','website','reach']} title="Referral contribution" kind="custom" displayRows={rows('website_contribution')} sourceRowsByQuery={{website_contribution:rows('website_contribution'),website:rows('website'),reach:rows('reach')}} variant="card">
        {(()=>{const contribution=rows('website_contribution')[0];return Number.isFinite(contribution?.rank)&&contribution.rank>0?<InsightCallout>egm.dev ranks #{contribution.rank} among GitHub’s top ten referrers and accounts for {percentage(contribution.topTenShare)} of the views attributed to them.</InsightCallout>:<InsightCallout>egm.dev is not among GitHub’s top ten referrers for {window}, so its rank and share are unknown.</InsightCallout>})()}
        <p className="egm-note">Referral views measure arrivals at the GitHub repo from egm.dev, not website visits or conversion. Total egm.dev visitor counts are not collected.</p>
      </DataComponent>
      {chartHome({id:'website-referrals',queryId:'referrers',title:'Views by referring source',summary:combinedReferralViews(rows('referrers'))[0]?`${combinedReferralViews(rows('referrers'))[0].source} leads recorded referrals with ${n(combinedReferralViews(rows('referrers'))[0].count)} repo views.`:'No referring sources are recorded for this window.',page:'acquisition',linkLabel:'Acquisition',displayRows:combinedReferralViews(rows('referrers')),sourceRows:rows('referrers')})}
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
      {item('issue-activity',6,<Plot id="issue-activity" queryId="activity" title="Daily issue activity" rows={rows('activity')} spec={{...line('openedIssues',['openedIssues','closedIssues']),type:'bar',colors:{openedIssues:'var(--chart-1)',closedIssues:'var(--chart-4)'},legend:{labels:{openedIssues:'Opened issues',closedIssues:'Closed issues'}}}} description={`${dateSpan(rows('activity'))} UTC.`} />)}
      {item('issue-queue',12,<Table id="issue-queue" queryId="issue_queue" title="Open issues by discussion volume" rows={rows('issue_queue')} searchable columns={[{field:'number',label:'#'},{field:'title',label:'Issue',renderCell:(v,r)=>safeExternalUrl(r.url)?<a href={safeExternalUrl(r.url)} target="_blank" rel="noreferrer">{v}</a>:v},{field:'comments',label:'Comments'}]} />,'table')}
    </SortableRegion>
    </Section>
    <p className="egm-note">Comment counts show how much an issue is discussed, not its severity. Release downloads are on the Adoption tab.</p>
  </>
  const starHistory=rows('star_history')
  const historyObservedAt=queries.star_history?.source?.executedAt
  return <>
    <OverviewSummary queries={queries}/>
    <Welcome/>
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
      {item('visitor-trend',6,<Plot id="visitor-trend" queryId="traffic" title="Daily views and unique visitors" rows={plotDaily} sourceRows={daily} spec={{...line('views',['views','visitors']),legend:{labels:{views:'Views',visitors:'Unique visitors per day'}}}} description={`${window}. Missing dates are blank. GitHub reports each day separately; daily unique visitors cannot be summed.`} />)}
      {item('clone-trend',6,clonePlot('clone-trend'))}
      {item('star-history',12,<StarGrowth rows={starHistory} observedAt={historyObservedAt} stale={queries.star_history?.source?.caveats?.some(text=>text.startsWith('Star history is stale:'))} observations={queries.star_observations} reportDates={reportDates}/>)}
      {item('referral-chart',6,chartHome({id:'referral-chart',queryId:'referrers',title:'Where repo traffic comes from',summary:'No referring sources are recorded for this window.',page:'acquisition',linkLabel:'Explore acquisition',ranked:true,displayRows:combinedReferralViews(rows('referrers')),sourceRows:rows('referrers')}))}
      {item('popular-paths',6,chartHome({id:'popular-paths',queryId:'paths',title:'What visitors read',summary:'No popular pages are recorded for this window.',page:'acquisition',linkLabel:'Explore repo traffic',ranked:true,displayRows:popularPageRows(rows('paths')),sourceRows:rows('paths')}))}
    </SortableRegion>
  </>
}
