import {knownVideos} from './youtube.mjs'

const dayMs=86400000
const dailyLimit=3, lifetimeLimit=21, sampleLimit=10
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)

export async function collectYouTubeComments(env,request=fetch,queries={},time=Date.now()) {
  const at=new Date(time).toISOString(),day=at.slice(0,10)
  const old=queries.youtube_comments,prior=queries.youtube_comments_status?.rows?.[0]
  const videos=knownVideos(queries.mentions?.rows??[])
  const rows=new Map((old?.rows??[]).map(row=>[row.videoId,{...row}]))
  let dailyAttempts=prior?.collectionDay===day?prior.dailyAttempts??0:0
  let totalAttempts=prior?.totalAttempts??0,attempts=0
  const cutoff=Date.parse(env.REFRESH_UNTIL)
  const active=Number.isFinite(cutoff)&&time<cutoff
  const attempted=video=>Date.parse(rows.get(video.videoId)?.lastAttemptAt??'')
  const due=videos.filter(video=>!Number.isFinite(attempted(video))||time-attempted(video)>=dayMs).sort((a,b)=>{
    const x=attempted(a),y=attempted(b)
    return Number(Number.isFinite(x))-Number(Number.isFinite(y))||(x||0)-(y||0)
  })
  if(active&&env.YOUTUBE_API_KEY)for(const video of due) {
    if(dailyAttempts>=dailyLimit||totalAttempts>=lifetimeLimit)break
    dailyAttempts++;totalAttempts++;attempts++
    const row={...rows.get(video.videoId),videoId:video.videoId,lastAttemptAt:at,status:'unavailable'}
    try {
      const url='https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId='+video.videoId+'&maxResults='+sampleLimit+'&order=relevance&textFormat=plainText'
      const response=await request(url,{redirect:'error',headers:{'x-goog-api-key':env.YOUTUBE_API_KEY},signal:AbortSignal.timeout(15000)})
      if(!response.ok)throw Error('comments_unavailable')
      const payload=await response.json()
      if(!Array.isArray(payload.items))throw Error('invalid_comments')
      const comments=[]
      for(const item of payload.items.slice(0,sampleLimit)) {
        const snippet=item?.snippet,comment=snippet?.topLevelComment
        if(snippet?.videoId!==video.videoId||!validId(comment?.id)||typeof comment.snippet?.textDisplay!=='string')throw Error('invalid_comment')
        const text=comment.snippet.textDisplay.trim().slice(0,350)
        if(text)comments.push({id:comment.id,text,url:'https://www.youtube.com/watch?v='+video.videoId+'&lc='+comment.id})
      }
      Object.assign(row,{comments,observedAt:at,status:'available'})
    } catch {}
    rows.set(video.videoId,row)
  }
  const output=videos.map(video=>rows.get(video.videoId)).filter(Boolean)
  const source={label:'YouTube · sampled top-level comments',provider:'YouTube Data API',executedAt:at,metricDefinitions:[{label:'Comment sample',definition:'Up to 10 relevance-ordered top-level comments returned for each known video, truncated to 350 characters. This is a sample, not a complete or representative count.'}],caveats:['Only known video IDs are queried. At most three requests per UTC day and 21 lifetime requests, including failures; each attempt is cached for 24 hours. No pagination or replies are requested.','Failed checks retain the previous sample and its observation time. Missing samples are unknown, not evidence of no comments. Author identities are not stored.'],links:videos.map(video=>({label:video.title??video.videoId,url:video.url})),evidenceFlow:[{title:'Official YouTube Data API',detail:'GET commentThreads with part=snippet, a known videoId, order=relevance, textFormat=plainText and maxResults=10'}]}
  return {youtube_comments:{rows:output,source:attempts===0&&old?.source?old.source:source},youtube_comments_status:{rows:[{status:!active?'expired':!env.YOUTUBE_API_KEY?'unconfigured':attempts?'checked':'cached',collectionDay:day,dailyAttempts,totalAttempts,attempts,dailyLimit,lifetimeLimit,sampleLimit}],source:{...source,label:'YouTube · comment collection status'}}}
}
