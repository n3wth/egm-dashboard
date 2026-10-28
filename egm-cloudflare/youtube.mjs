import {canonicalMentionUrl} from './mentions.mjs'
const dayMs=86400000
const count=value=>(typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null
const string=value=>typeof value==='string'?value.slice(0,350):null
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)&&Number.isFinite(Date.parse(value))?value:null
function thumbnail(value,id) {
  try {const url=new URL(value);return url.protocol==='https:'&&['i.ytimg.com','img.youtube.com'].includes(url.hostname)&&url.pathname.includes('/'+id+'/')?url.href:null} catch{return null}
}
export function knownVideos(mentions) {
  const rows=new Map()
  for(const row of mentions) {
    const url=canonicalMentionUrl(row.url)
    if(!url||new URL(url).hostname!=='www.youtube.com')continue
    const videoId=new URL(url).searchParams.get('v')
    if(/^[A-Za-z0-9_-]{11}$/.test(videoId)) rows.set(videoId,{videoId,url,title:row.title??null})
  }
  return [...rows.values()].slice(0,10)
}
export function alexandriaVideoRecord(entry,video,at) {
  if(entry?.provider!=='youtube-com'||entry.capability!=='videos/video_details'||entry.error||entry.data?.video_id!==video.videoId) throw Error('invalid_video_provider_response')
  const data=entry.data
  const observedAt=Number.isFinite(data.observed_at_ms)?new Date(data.observed_at_ms).toISOString():at
  const thumbnails=(data.thumbnails??[]).map(t=>({...t,url:thumbnail(t.url,video.videoId)})).filter(t=>t.url).sort((a,b)=>(b.width??0)-(a.width??0))
  return {...video,title:string(data.title)??video.title,channel:string(data.channel_name),thumbnail:thumbnails[0]?.url??null,published:date(data.published_at??data.publish_date??data.upload_date),views:count(data.view_count),likes:count(data.like_count),comments:null,observedAt,statsObservedAt:observedAt,statsSource:'Firecrawl Alexandria · YouTube player',statsStatus:'available',status:count(data.view_count)!==null?'available':'metadata_only',statsProvenance:{provider:'youtube-com',capability:'videos/video_details',workflow:entry.workflow??null,providerRequestId:entry.providerRequestId??null,playabilityStatus:string(data.playability_status)}}
}
function source(at,rows) {
  return {label:'YouTube · observed video metadata and statistics',provider:'YouTube / Firecrawl',executedAt:at,coverage:{startDate:at.slice(0,10),endDate:at.slice(0,10)},metricDefinitions:[{label:'Video metadata',definition:'Title, channel, and thumbnail from the official YouTube oEmbed response for an already discovered video.'},{label:'Video statistics',definition:'Actual provider-returned video views and likes, observed at the row timestamp. Source is YouTube Data API when configured, otherwise the Firecrawl Alexandria YouTube player provider. Missing/hidden values stay unknown, never zero.'}],caveats:['At most 10 known video metadata checks per UTC day. An explicitly enabled initial-day backfill allows 10 statistics checks on that day; later days allow three. Successful and failed attempts are cached for 24 hours.','Firecrawl statistics cost five credits per video per listed provider contract. All checks, including initial backfill and failures, share the 21-call lifetime cap (105 listed credits). No plan upgrades are performed.','oEmbed does not return views, likes, comments, or publication dates. Statistics and dates are not inferred from titles or search snippets.','Videos are discovered through incomplete public indexed search. Gallery size and video views are not EGM adoption or unique reach.','Previously observed statistics may remain when a later collection fails; statsObservedAt preserves their original observation time.'],links:rows.map(row=>({label:row.title??row.videoId,url:row.url})),evidenceFlow:[{title:'Official metadata',detail:'GET https://www.youtube.com/oembed?url=<known canonical video URL>&format=json'},{title:'Optional official statistics',detail:'GET https://www.googleapis.com/youtube/v3/videos with known IDs and part=snippet,statistics'},{title:'Bounded statistics provider',detail:'POST https://api.firecrawl.dev/v2/scrape with alexandria youtube-com/videos/video_details and one known video_id'}]}
}
export async function collectYouTube(env,request=fetch,previousQueries={},time=Date.now()) {
  const at=new Date(time).toISOString(),day=at.slice(0,10)
  const oldStatus=previousQueries.youtube_status?.rows?.[0]
  let metadataAttempts=oldStatus?.collectionDay===day?oldStatus.metadataAttempts??0:0
  let statsAttempts=oldStatus?.collectionDay===day?oldStatus.statsAttempts??0:0
  let totalStatsAttempts=oldStatus?.totalStatsAttempts??0
  const backfillEnabled=String(env.VIDEO_INITIAL_BACKFILL_LIMIT)==='10'
  const initialBackfillDay=oldStatus?.initialBackfillDay??(backfillEnabled&&totalStatsAttempts===statsAttempts&&totalStatsAttempts<10?day:null)
  const statsDailyLimit=backfillEnabled&&initialBackfillDay===day?10:3
  const oldRows=previousQueries.youtube_videos?.rows??[]
  const rows=new Map(oldRows.map(row=>[row.videoId,{...row}]))
  const videos=knownVideos(previousQueries.mentions?.rows??[])
  let creditsUsed=0,hasCredits=false,status='available',checks=0
  const cutoff=Date.parse(env.REFRESH_UNTIL)
  if(!Number.isFinite(cutoff)||time>=cutoff)status='expired'
  else {
    for(const video of videos) {
      const old=rows.get(video.videoId)
      if(metadataAttempts>=10)break
      if(old?.metadataAttemptAt&&time-Date.parse(old.metadataAttemptAt)<dayMs)continue
      metadataAttempts++
      checks++
      const row={views:null,likes:null,comments:null,channel:null,thumbnail:null,published:null,statsSource:null,observedAt:at,...old,...video,metadataAttemptAt:at,status:old?.status??'unavailable'}
      try {
        const url='https://www.youtube.com/oembed?url='+encodeURIComponent(video.url)+'&format=json'
        const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(15000)})
        if(!response.ok)throw Error('metadata_unavailable')
        const payload=await response.json()
        if(payload.provider_name!=='YouTube'||typeof payload.title!=='string')throw Error('invalid_metadata')
        row.title=string(payload.title)
        row.channel=string(payload.author_name)
        row.thumbnail=thumbnail(payload.thumbnail_url,video.videoId)
        row.metadataObservedAt=at
        if(row.views===null){row.status='metadata_only';row.observedAt=at}
        row.metadataError=null
      } catch {row.metadataError='oembed_unavailable'}
      rows.set(video.videoId,row)
    }
    const attemptedAt=video=>Date.parse(rows.get(video.videoId)?.statsAttemptAt??'')
    const due=videos.filter(video=>!Number.isFinite(attemptedAt(video))||time-attemptedAt(video)>=dayMs).sort((a,b)=>{
      const aTime=attemptedAt(a),bTime=attemptedAt(b)
      return Number(Number.isFinite(aTime))-Number(Number.isFinite(bTime))||(aTime||0)-(bTime||0)
    }).slice(0,Math.max(0,Math.min(statsDailyLimit-statsAttempts,21-totalStatsAttempts)))
    if(env.YOUTUBE_API_KEY&&due.length) {
      statsAttempts+=due.length
      totalStatsAttempts+=due.length
      checks+=due.length
      for(const video of due)rows.set(video.videoId,{...rows.get(video.videoId),...video,statsAttemptAt:at})
      try {
        const url='https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id='+due.map(video=>video.videoId).join(',')
        const response=await request(url,{redirect:'error',headers:{'x-goog-api-key':env.YOUTUBE_API_KEY},signal:AbortSignal.timeout(15000)})
        if(!response.ok)throw Error('statistics_unavailable')
        const payload=await response.json()
        if(!Array.isArray(payload.items))throw Error('invalid_statistics')
        for(const item of payload.items) {
          if(!due.some(video=>video.videoId===item.id))continue
          const row=rows.get(item.id),snippet=item.snippet??{},stats=item.statistics??{}
          Object.assign(row,{title:string(snippet.title)??row.title,channel:string(snippet.channelTitle)??row.channel,published:date(snippet.publishedAt),views:count(stats.viewCount),likes:count(stats.likeCount),comments:count(stats.commentCount),statsSource:'YouTube Data API',statsObservedAt:at,observedAt:at,statsStatus:'available',status:count(stats.viewCount)!==null?'available':'metadata_only'})
        }
      } catch {for(const video of due)Object.assign(rows.get(video.videoId),{statsStatus:'unavailable'})}
    } else if(env.FIRECRAWL_API_KEY) {
      for(const video of due) {
        statsAttempts++
        totalStatsAttempts++
        checks++
        const row={views:null,likes:null,comments:null,...rows.get(video.videoId),...video,statsAttemptAt:at}
        rows.set(video.videoId,row)
        try {
          const response=await request('https://api.firecrawl.dev/v2/scrape',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+env.FIRECRAWL_API_KEY,'content-type':'application/json'},body:JSON.stringify({alexandria:{provider:'youtube-com',capability:'videos/video_details',options:{video_id:video.videoId}}}),signal:AbortSignal.timeout(25000)})
          if(!response.ok)throw Error('statistics_unavailable')
          const payload=await response.json()
          const entry=payload.data?.alexandria?.find(item=>item.provider==='youtube-com'&&item.capability==='videos/video_details')
          const observed=alexandriaVideoRecord(entry,video,at)
          Object.assign(row,observed,{thumbnail:observed.thumbnail??row.thumbnail,metadataAttemptAt:row.metadataAttemptAt})
          const usage=payload.data?.creditsCost??payload.creditsCost
          if(Number.isFinite(usage)){creditsUsed+=usage;hasCredits=true}
        } catch {row.statsStatus='unavailable'}
      }
    }
  }
  const output=videos.map(video=>rows.get(video.videoId)??{...video,channel:null,thumbnail:null,published:null,views:null,likes:null,comments:null,observedAt:null,statsSource:null,status:'unavailable'})
  const checked=source(at,output)
  const provenance=checks===0&&previousQueries.youtube_videos?.source?previousQueries.youtube_videos.source:checked
  return {youtube_videos:{rows:output,source:provenance},youtube_status:{rows:[{status,collectionDay:day,initialBackfillDay,metadataAttempts,statsAttempts,totalStatsAttempts,lastAttemptAt:at,metadataDailyLimit:10,statsDailyLimit,statsLifetimeLimit:21,statsConfigured:!!(env.YOUTUBE_API_KEY||env.FIRECRAWL_API_KEY),...(hasCredits?{creditsUsed}:{})}],source:{...checked,label:'YouTube · collection coverage (status checked at this time)'}}}
}
