import test from 'node:test'
import assert from 'node:assert/strict'
import {alexandriaVideoRecord,collectYouTube,knownVideos} from './youtube.mjs'
const now=Date.parse('2026-10-28T20:00:00Z')
const env={REFRESH_UNTIL:'2026-11-04T20:00:00Z',FIRECRAWL_API_KEY:'test-only'}
const ids=['xxf6D9jynFw','GUhW6I-c3iA','Xrcrnoi_SoE','GIgjxZJ7zKQ']
const queries={mentions:{rows:ids.map(id=>({url:'https://www.youtube.com/watch?v='+id,title:'EGM video',kind:'Video'}))}}
const metadata=id=>({provider_name:'YouTube',title:'EGM observed '+id,author_name:'A channel',thumbnail_url:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'})
const provider=(id,views=123)=>({provider:'youtube-com',capability:'videos/video_details',data:{video_id:id,title:'Actual title',channel_name:'Actual channel',published_at:'2026-10-25T15:01:21Z',view_count:views,like_count:null,observed_at_ms:now,thumbnails:[{url:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',width:480}]}})
test('only actual known valid YouTube IDs enter gallery and watch variants deduplicate',()=>{
  const rows=knownVideos([...queries.mentions.rows,{url:'https://youtu.be/'+ids[0]},{url:'https://youtube.com/watch?v=bad'},{url:'https://evil.test/watch?v='+ids[0]}])
  assert.equal(rows.length,4)
})
test('provider counts must be exact nonnegative safe integers and missing counts stay unknown',()=>{
  const video={videoId:ids[0],url:queries.mentions.rows[0].url}
  const row=alexandriaVideoRecord(provider(ids[0]),video,new Date(now).toISOString())
  assert.equal(row.views,123);assert.equal(row.likes,null);assert.equal(row.comments,null)
  assert.equal(row.published,'2026-10-25T15:01:21Z')
  assert.throws(()=>alexandriaVideoRecord(provider(ids[1]),video,new Date(now).toISOString()))
  assert.equal(alexandriaVideoRecord(provider(ids[0],'1.2K'),video,new Date(now).toISOString()).views,null)
})
test('metadata does not invent statistics; daily metadata and stats attempts are bounded and cached',async()=>{
  let oembed=0,stats=0
  const request=async(url,init)=>{
    if(url.startsWith('https://www.youtube.com/oembed')){oembed++;return Response.json(metadata(new URL(new URL(url).searchParams.get('url')).searchParams.get('v')))}
    assert.equal(url,'https://api.firecrawl.dev/v2/scrape');assert.equal(init.redirect,'error')
    stats++;const id=JSON.parse(init.body).alexandria.options.video_id
    return Response.json({success:true,data:{alexandria:[provider(id)],creditsCost:5}})
  }
  const first=await collectYouTube(env,request,queries,now)
  assert.equal(oembed,4);assert.equal(stats,3)
  assert.equal(first.youtube_videos.rows.find(r=>r.videoId===ids[3]).views,null)
  assert.equal(first.youtube_status.rows[0].creditsUsed,15)
  const cached=await collectYouTube(env,async()=>assert.fail('cached'),{...queries,...first},now+1000)
  assert.deepEqual(cached.youtube_videos.source,first.youtube_videos.source)
  assert.equal(cached.youtube_status.source.executedAt,new Date(now+1000).toISOString())
})
test('failure retains previously observed counts and does not refresh their observation date',async()=>{
  const old={...alexandriaVideoRecord(provider(ids[0]),{videoId:ids[0],url:queries.mentions.rows[0].url},new Date(now).toISOString()),metadataAttemptAt:new Date(now).toISOString(),statsAttemptAt:new Date(now).toISOString()}
  const result=await collectYouTube(env,async()=>new Response('unavailable',{status:403}),{mentions:{rows:[queries.mentions.rows[0]]},youtube_videos:{rows:[old]}},now+86400000)
  assert.equal(result.youtube_videos.rows[0].views,123)
  assert.equal(result.youtube_videos.rows[0].statsObservedAt,old.statsObservedAt)
  assert.equal(result.youtube_videos.rows[0].statsStatus,'unavailable')
})
test('cutoff and 21 lifetime statistic checks prevent paid provider calls',async()=>{
  const result=await collectYouTube(env,async(url)=>{
    assert.ok(url.startsWith('https://www.youtube.com/oembed'))
    return Response.json(metadata(ids[0]))
  },{mentions:{rows:[queries.mentions.rows[0]]},youtube_status:{rows:[{totalStatsAttempts:21}]}},now)
  assert.equal(result.youtube_status.rows[0].statsAttempts,0)
  const expired=await collectYouTube({...env,REFRESH_UNTIL:'2026-10-01'},async()=>assert.fail('expired'),queries,now)
  assert.equal(expired.youtube_status.rows[0].status,'expired')
})
test('statistics rotate through never-checked videos then oldest attempts, including failures',async()=>{
  const stableIds=Array.from({length:10},(_,i)=>'video'+String(i).padStart(6,'0'))
  const mentions={rows:stableIds.map(id=>({url:'https://www.youtube.com/watch?v='+id,title:'EGM video',kind:'Video'}))}
  const byDay=[]
  let previous={mentions}
  for(let day=0;day<4;day++) {
    const called=[]
    const request=async(url,init)=>{
      if(url.startsWith('https://www.youtube.com/oembed'))return Response.json(metadata(new URL(new URL(url).searchParams.get('url')).searchParams.get('v')))
      const id=JSON.parse(init.body).alexandria.options.video_id
      called.push(id)
      if(day===0&&id===stableIds[0])return new Response('unavailable',{status:403})
      return Response.json({success:true,data:{alexandria:[provider(id)],creditsCost:5}})
    }
    const result=await collectYouTube(env,request,previous,now+day*86400000)
    assert.equal(result.youtube_status.rows[0].statsAttempts,3)
    assert.equal(result.youtube_status.rows[0].totalStatsAttempts,(day+1)*3)
    previous={mentions,...result}
    byDay.push(called)
    await collectYouTube(env,async()=>assert.fail('daily cached'),previous,now+day*86400000+1000)
  }
  assert.deepEqual(byDay[0],stableIds.slice(0,3))
  assert.deepEqual(byDay[1],stableIds.slice(3,6))
  assert.deepEqual(byDay[2],stableIds.slice(6,9))
  assert.deepEqual(byDay[3],[stableIds[9],stableIds[0],stableIds[1]])
})
test('explicit initial backfill fills ten first-day rows then returns to three per day within lifetime cap',async()=>{
  const stableIds=Array.from({length:10},(_,i)=>'video'+String(i).padStart(6,'0'))
  const mentions={rows:stableIds.map(id=>({url:'https://www.youtube.com/watch?v='+id,title:'EGM video'}))}
  let calls=0
  const request=async(url,init)=>{
    if(url.startsWith('https://www.youtube.com/oembed'))return Response.json(metadata(new URL(new URL(url).searchParams.get('url')).searchParams.get('v')))
    calls++
    return Response.json({data:{alexandria:[provider(JSON.parse(init.body).alexandria.options.video_id)],creditsCost:5}})
  }
  const enabled={...env,VIDEO_INITIAL_BACKFILL_LIMIT:'10'}
  const initial=await collectYouTube(env,request,{mentions},now)
  const filled=await collectYouTube(enabled,request,{mentions,...initial},now+1000)
  assert.equal(calls,10)
  assert.equal(filled.youtube_status.rows[0].totalStatsAttempts,10)
  assert.equal(filled.youtube_status.rows[0].statsDailyLimit,10)
  assert.ok(filled.youtube_videos.rows.every(row=>row.views===123))
  await collectYouTube(enabled,async()=>assert.fail('cached'),{mentions,...filled},now+2000)
  const next=await collectYouTube(enabled,request,{mentions,...filled},now+86401000)
  assert.equal(next.youtube_status.rows[0].statsDailyLimit,3)
  assert.equal(next.youtube_status.rows[0].totalStatsAttempts,13)
  const almost={...next,youtube_status:{rows:[{...next.youtube_status.rows[0],collectionDay:'2026-10-28',totalStatsAttempts:20,statsAttempts:0}]}}
  const capped=await collectYouTube(enabled,request,{mentions,...almost},now+2*86401000)
  assert.equal(capped.youtube_status.rows[0].totalStatsAttempts,21)
})
test('with a YouTube Data API key every tracked video gets statistics in one call, including new ones',async()=>{
  const apiEnv={REFRESH_UNTIL:env.REFRESH_UNTIL,YOUTUBE_API_KEY:'test-only'}
  let oembed=0,api=[]
  const item=id=>({id,snippet:{title:'T '+id,channelTitle:'C',publishedAt:'2026-10-25T15:01:21Z'},statistics:{viewCount:'10',likeCount:'2',commentCount:'1'}})
  const request=async(url,init)=>{
    if(url.startsWith('https://www.youtube.com/oembed')){oembed++;return Response.json(metadata(new URL(new URL(url).searchParams.get('url')).searchParams.get('v')))}
    assert.match(url,/^https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?part=snippet,statistics&id=/)
    assert.equal(init.headers['x-goog-api-key'],'test-only')
    const requested=new URL(url).searchParams.get('id').split(',');api.push(requested)
    return Response.json({items:requested.map(item)})
  }
  const first=await collectYouTube(apiEnv,request,queries,now)
  assert.equal(api.length,1);assert.equal(api[0].length,4)
  assert.ok(first.youtube_videos.rows.every(row=>row.views===10&&row.likes===2&&row.comments===1))
  const same=await collectYouTube(apiEnv,async url=>url.startsWith('https://www.youtube.com/oembed')?assert.fail('cached'):assert.fail('stats cached'),{...queries,...first},now+60000)
  assert.equal(same.youtube_videos.rows.length,4)
  const added='AbCdEfGhIjK'
  const withNew={...queries,...first,mentions:{rows:[...queries.mentions.rows,{url:'https://www.youtube.com/watch?v='+added,title:'New',kind:'Video'}]}}
  const next=await collectYouTube(apiEnv,request,withNew,now+120000)
  assert.deepEqual(api.at(-1),[added])
  assert.equal(next.youtube_videos.rows.find(row=>row.videoId===added).views,10)
})
