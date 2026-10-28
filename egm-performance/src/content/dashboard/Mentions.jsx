import {percentage} from './percentage.mjs'
import React from 'react'
import {DataComponent,DataTable,Section,useDataApp} from '../../data-app-public.jsx'
import {SiteName} from './SiteName.jsx'
import {InsightCallout} from './InsightCallout.jsx'
import {EngagementSignals} from './EngagementSignals.jsx'
import {PageSummary} from './PageSummary.jsx'
import {VideoThumbnail} from './VideoThumbnail.jsx'

const stamp=value=>!value?'Unknown':/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'}):new Date(value).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' PT'
const mentionLink=(value,row)=><a className="egm-mention-link" href={row.url} target="_blank" rel="noreferrer nofollow">{value}</a>
const dateValue=value=>{if(!value)return null;const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value);return Number.isFinite(date.getTime())?date:null}
function ShortDate({value}) {
  const date=dateValue(value)
  if(!date)return <span title="Date unavailable" aria-label="Date unavailable">—</span>
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value)
  const full=date.toLocaleString('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'long',day:'numeric',...(!dateOnly?{hour:'numeric',minute:'2-digit',timeZoneName:'short'}:{})})
  return <time dateTime={value} title={full} aria-label={full}>{date.toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'})}</time>
}
const mentionTitle=(value,row)=><div className="egm-mentions-title">{mentionLink(value,row)}<div className="egm-mentions-detail"><SiteName url={row.url} label={row.platform??row.domain}/><EngagementSignals row={row}/>{row.discoveryProviders?.length>0&&<span>Found by {row.discoveryProviders.join(' and ')}</span>}{dateValue(row.published)&&<span>Published <ShortDate value={row.published}/></span>}</div></div>
function MentionRows({rows,label}) {
  const columns=[{field:'title',label:'Mention',renderCell:mentionTitle},...(rows.some(row=>dateValue(row.firstSeen))?[{field:'firstSeen',label:'First seen',renderCell:value=><ShortDate value={value}/>}]:[])]
  return <div className="egm-mentions-table" data-has-dates={columns.length>1?'true':'false'}><DataTable rows={rows} searchable={rows.length>8} label={label} columns={columns}/></div>
}
const videoId=value=>{try{const url=new URL(value);if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname))return null;const id=url.hostname==='youtu.be'?url.pathname.split('/')[1]:url.searchParams.get('v')??url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];return /^[A-Za-z0-9_-]{11}$/.test(id??'')?id:null}catch{return null}}
function VideoGallery({rows,queries}) {
  const metadata=queries.youtube_videos?.rows??[]
  const comments=queries.youtube_comments?.rows??[]
  const queryIds=['mentions',...(queries.youtube_videos?['youtube_videos']:[]),...(queries.youtube_comments?['youtube_comments']:[])]
  const videos=rows.map(row=>{const id=videoId(row.url);const details=metadata.find(item=>item.videoId===id||videoId(item.url)===id);return {...row,...details,title:details?.title||row.title,published:details?.published||row.published,id,commentSample:comments.find(item=>item.videoId===id)}}).filter(row=>row.id)
  const measured=videos.filter(row=>Number.isFinite(row.views)&&row.views>=0).sort((a,b)=>b.views-a.views)
  const observedViews=measured.reduce((total,row)=>total+row.views,0)
  return <DataComponent id="mentions-youtube-gallery" queryId="mentions" queryIds={queryIds} title="YouTube" kind="custom" variant="card" displayRows={videos} sourceRowsByQuery={{mentions:queries.mentions?.rows??[],...(queries.youtube_videos?{youtube_videos:metadata}:{}),...(queries.youtube_comments?{youtube_comments:comments}:{})}}>
    {measured.length>=2&&observedViews>0&&<InsightCallout action="Test a short first-run guide alongside the most-viewed video.">The most-viewed measured video accounts for {percentage(measured[0].views/observedViews)} of observed views across {measured.length} videos with available counts.</InsightCallout>}
    <div className="egm-video-gallery" data-reviewed-rows>{videos.map(row=><article className="egm-video-card" key={row.id}>
      <a className="egm-video-link" href={`https://www.youtube.com/watch?v=${row.id}`} target="_blank" rel="noreferrer"><VideoThumbnail id={row.id} sizes="(max-width: 550px) 100vw, (max-width: 1000px) 50vw, 33vw"/><h3 title={row.title}>{row.title}</h3></a>
      {(row.channelTitle||row.channel||dateValue(row.published))&&<p className="egm-video-meta egm-video-byline"><span title={row.channelTitle??row.channel??''}>{row.channelTitle??row.channel}</span>{dateValue(row.published)&&<>{(row.channelTitle||row.channel)&&<span aria-hidden="true"> · </span>}<ShortDate value={row.published}/></>}</p>}
      <div className="egm-video-stats"><EngagementSignals row={row}/></div>
      {row.commentSample&&<details className="egm-video-comments"><summary className="egm-video-meta">Comment sample{row.commentSample.comments?.length>0&&` (${row.commentSample.comments.length})`} {row.commentSample.observedAt&&<>observed <ShortDate value={row.commentSample.observedAt}/></>}{row.commentSample.status==='unavailable'&&(row.commentSample.observedAt?' · refresh failed, cached':' · unavailable')}</summary>{row.commentSample.comments?.length>0?<ul>{row.commentSample.comments.map(comment=><li key={comment.id}><a href={comment.url} target="_blank" rel="noreferrer nofollow">{comment.text}</a></li>)}</ul>:row.commentSample.status==='available'&&<p className="egm-video-meta">No comments returned in this sample.</p>}</details>}
    </article>)}</div>
  </DataComponent>
}
const canonicalUrl=value=>{
  try {
    const url=new URL(value)
    url.hostname=url.hostname.toLowerCase().replace(/^www\./,'').replace(/^twitter\.com$/,'x.com')
    if(['m.youtube.com','youtu.be','youtube.com'].includes(url.hostname)) {
      const id=url.hostname==='youtu.be'?url.pathname.split('/')[1]:url.searchParams.get('v')??url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]
      if(id) return 'https://youtube.com/watch?v='+id
    }
    url.hash=''
    for(const key of [...url.searchParams.keys()]) if(/^(utm_|fbclid$|gclid$|ref$|source$|si$)/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    url.pathname=url.pathname.replace(/\/$/,'')||'/'
    return url.href
  } catch {return value}
}

function additionalDiscovery(queries,primaryRows) {
  const providers=[['Exa','exa_mentions','exa_status'],['Tavily','tavily_mentions','tavily_status'],['Parallel','parallel_mentions','parallel_status']].filter(([,id,statusId])=>queries[id]||queries[statusId])
  const known=new Set(primaryRows.map(row=>canonicalUrl(row.url)))
  const unique=new Map()
  const sourceRowsByQuery={}
  for(const [provider,id,statusId] of providers) {
    if(queries[id])sourceRowsByQuery[id]=queries[id].rows
    if(queries[statusId])sourceRowsByQuery[statusId]=queries[statusId].rows
    for(const row of queries[id]?.rows??[]) {
      const url=canonicalUrl(row.url)
      if(known.has(url))continue
      const previous=unique.get(url)
      if(previous) {
        previous.discoveryProviders=[...new Set([...previous.discoveryProviders,provider])]
        if(dateValue(row.firstSeen)&&(!dateValue(previous.firstSeen)||Date.parse(row.firstSeen)<Date.parse(previous.firstSeen)))previous.firstSeen=row.firstSeen
        if(!previous.published&&row.published)previous.published=row.published
      } else unique.set(url,{...row,discoveryProviders:[provider]})
    }
  }
  return {providers,rows:[...unique.values()],sourceRowsByQuery,queryIds:Object.keys(sourceRowsByQuery)}
}
function CollectionNote({provider,status}) {
  if(!status)return null
  return <span className="egm-mentions-collection"><SiteName label={provider}/> {dateValue(status.lastSuccessAt)?<ShortDate value={status.lastSuccessAt}/>:<span>not yet collected</span>}{status.status==='stale'&&<span>(refresh failed, cached)</span>}{status.status==='unavailable'&&<span>(unavailable)</span>}</span>
}
function SupplementaryMentions({discovery}) {
  const {rows,queryIds,sourceRowsByQuery,providers}=discovery
  if(!rows.length)return null
  return <Section title="Additional discovery" id="mentions-exa">
    <DataComponent id="mentions-exa-table" queryId={queryIds[0]} queryIds={queryIds} title="Search results" kind="table" variant="card" displayRows={rows} sourceRowsByQuery={sourceRowsByQuery}>
      <MentionRows rows={rows} label="Search results"/>
    </DataComponent>
  </Section>
}

export function mentionSummarySources(queries,discovery) {
  // Reviewed source rows remain untouched; engagement joins belong in displayRows.
  return {mentions:queries.mentions?.rows??[],mentions_status:queries.mentions_status?.rows??[],...discovery.sourceRowsByQuery}
}

export function Mentions() {
  const {queries}=useDataApp()
  const query=queries.mentions
  const engagement=queries.mention_engagement?.rows??[]
  const enrich=row=>({...row,...engagement.find(item=>canonicalUrl(item.url)===canonicalUrl(row.url))})
  const rows=(query?.rows??[]).map(enrich)
  const discovery=additionalDiscovery(queries,rows)
  discovery.rows=discovery.rows.map(enrich)
  if(queries.mention_engagement){discovery.sourceRowsByQuery.mention_engagement=engagement;discovery.queryIds.push('mention_engagement')}
  const allRows=[...rows,...discovery.rows]
  const status=queries.mentions_status?.rows?.[0]
  const earliest=allRows.map(row=>row.firstSeen).filter(Boolean).sort()[0]
  const since=earliest?new Date(earliest).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'}):null
  const groups=[['Video','YouTube'],['Social','Social posts'],['Media / web','Media and web'],['Official','Official announcements']]
  const firstKind=groups.find(([kind])=>rows.some(row=>row.kind===kind))?.[0]
  return <>
    <PageSummary page="mentions" queries={queries}/>
    {groups.map(([kind,title])=>{
      const selected=rows.filter(row=>row.kind===kind)
      if(!selected.length) return null
      return <Section key={kind} title={kind==='Video'?undefined:title} spacing={kind===firstKind?'none':'section'} id={'mentions-'+kind.toLowerCase().replaceAll(/[^a-z]+/g,'-')}>
        {kind==='Video'?<VideoGallery rows={selected} queries={queries}/>:<DataComponent id={'mentions-table-'+kind.toLowerCase().replaceAll(/[^a-z]+/g,'-')} queryId="mentions" queryIds={queries.mention_engagement?['mentions','mention_engagement']:['mentions']} title={`${selected.length} ${selected.length===1?'mention':'mentions'}`} kind="table" variant="card" displayRows={selected} sourceRowsByQuery={{mentions:query?.rows??[],...(queries.mention_engagement?{mention_engagement:engagement}:{})}}>
          <MentionRows rows={selected} label={`${title} mentions`}/>
        </DataComponent>}
      </Section>
    })}
    <SupplementaryMentions discovery={discovery}/>
    <Section id="mentions-coverage" spacing="none">
      {query?<DataComponent id="mentions-summary" queryId="mentions" queryIds={['mentions','mentions_status',...discovery.queryIds]} title="Collection" showHeading={false} showActions={false} className="egm-mentions-summary" kind="custom" variant="plain" displayRows={allRows} sourceRowsByQuery={mentionSummarySources(queries,discovery)}>
        <div className="egm-mentions-collection-line"><span title={since?`Discovered since ${since}`:undefined}>{allRows.length.toLocaleString('en-US')} discovered links</span>{discovery.providers.map(([provider,,statusId])=><CollectionNote key={statusId} provider={provider} status={queries[statusId]?.rows?.[0]}/>)}</div>
        {status?.status==='stale'&&<p className="egm-note">Latest search failed; showing cached results.</p>}
        {status?.status==='unavailable'&&<p className="egm-note">Search unavailable.</p>}
      </DataComponent>:<p className="egm-note">Public mentions have not completed their first collection.</p>}
    </Section>
  </>
}
