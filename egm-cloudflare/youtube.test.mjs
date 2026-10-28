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
