const day=86400000
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null
function hnId(value) {
  try {const url=new URL(value);const id=url.searchParams.get('id');return url.protocol==='https:'&&url.hostname==='news.ycombinator.com'&&url.pathname==='/item'&&!url.username&&!url.password&&!url.port&&/^\d{1,12}$/.test(id??'')&&Number(id)>0?id:null}catch{return null}
}
export async function collectEngagement(env,request=fetch,previousQueries={},time=Date.now()) {
  const at=new Date(time).toISOString(),collectionDay=at.slice(0,10)
  const old=previousQueries.mention_engagement
  const prior=previousQueries.mention_engagement_status?.rows?.[0]
  const ids=[...new Set(['mentions','exa_mentions','tavily_mentions','parallel_mentions'].flatMap(key=>(previousQueries[key]?.rows??[]).map(row=>hnId(row.url))).filter(Boolean))].slice(0,5)
  const rows=new Map((old?.rows??[]).map(row=>[row.hnId,{...row}]))
  let dailyAttempts=prior?.collectionDay===collectionDay?prior.dailyAttempts??0:0
  let attempts=0
  const cutoff=Date.parse(env.REFRESH_UNTIL)
  const active=Number.isFinite(cutoff)&&time<cutoff
  if(active)for(const id of ids) {
    if(dailyAttempts>=5)break
    const saved=rows.get(id)
    if(saved?.lastAttemptAt&&time-Date.parse(saved.lastAttemptAt)<day)continue
    attempts++;dailyAttempts++
    const row={...saved,hnId:id,url:'https://news.ycombinator.com/item?id='+id,lastAttemptAt:at,status:'unavailable',engagementSource:'Hacker News official API'}
    try {
      const response=await request('https://hacker-news.firebaseio.com/v0/item/'+id+'.json',{redirect:'manual',signal:AbortSignal.timeout(5000)})
      if(!response.ok||response.status>=300)throw Error('unavailable')
      const item=await response.json()
      if(!item||item.id!==Number(id)||item.type!=='story'||item.deleted||item.dead)throw Error('invalid_item')
      Object.assign(row,{hnPoints:count(item.score),comments:count(item.descendants),engagementObservedAt:at,observedAt:at,status:'available'})
    }catch{}
    rows.set(id,row)
  }
  const output=[...rows.values()]
  const source={label:'Hacker News · observed engagement',provider:'Hacker News',executedAt:at,links:output.map(row=>({label:'HN discussion',url:row.url})),metricDefinitions:[{label:'HN points',definition:'Official Hacker News story score, not views or unique users.'},{label:'Comments',definition:'Official descendants count including nested comments.'}],caveats:['Only discovered Hacker News story URLs are checked. Maximum five requests per UTC day, with 24-hour success and failure caching.','Old observed counts are retained on a failed refresh and keep their original observation date. Unknown counts remain unknown.']}
  return {mention_engagement:{rows:output,source:attempts===0&&old?.source?old.source:source},mention_engagement_status:{rows:[{status:!active?'expired':attempts?'checked':'cached',collectionDay,dailyAttempts,attempts,lastAttemptAt:at}],source:{...source,label:'Hacker News · collection status'}}}
}
