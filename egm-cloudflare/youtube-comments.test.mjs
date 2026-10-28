import test from 'node:test'
import assert from 'node:assert/strict'
import {collectYouTubeComments} from './youtube-comments.mjs'

const now=Date.parse('2026-10-28T20:00:00Z')
const env={REFRESH_UNTIL:'2026-11-10T00:00:00Z',YOUTUBE_API_KEY:'test-only'}
const ids=Array.from({length:5},(_,i)=>'video'+String(i).padStart(6,'0'))
const mentions={rows:ids.map(videoId=>({url:'https://www.youtube.com/watch?v='+videoId,title:'Video'}))}
const item=(videoId,id='comment_1',text='A real comment')=>({snippet:{videoId,topLevelComment:{id,snippet:{textDisplay:text,authorDisplayName:'Not retained'}}}})

test('samples only known videos, bounds requests, strips author data and caches attempts',async()=>{
  const calls=[]
  const request=async(url,init)=>{
    const parsed=new URL(url),id=parsed.searchParams.get('videoId')
    calls.push(id)
    assert.equal(parsed.searchParams.get('maxResults'),'10')
    assert.equal(parsed.searchParams.get('textFormat'),'plainText')
    assert.equal(init.redirect,'error')
    return Response.json({items:[item(id,'comment_1','x'.repeat(400))]})
  }
  const first=await collectYouTubeComments(env,request,{mentions},now)
  assert.deepEqual(calls,ids.slice(0,3))
  assert.equal(first.youtube_comments.rows[0].comments[0].text.length,350)
  assert.deepEqual(Object.keys(first.youtube_comments.rows[0].comments[0]),['id','text','url'])
  assert.equal(first.youtube_comments_status.rows[0].totalAttempts,3)
  const cached=await collectYouTubeComments(env,async()=>assert.fail('cached'),{mentions,...first},now+1000)
  assert.deepEqual(cached.youtube_comments.source,first.youtube_comments.source)
  const next=await collectYouTubeComments(env,request,{mentions,...cached},now+day())
  assert.deepEqual(calls.slice(3),[ids[3],ids[4],ids[0]])
  assert.equal(next.youtube_comments_status.rows[0].totalAttempts,6)
})
const day=()=>86400000

test('partial failures preserve old samples and timestamps; empty success remains distinct',async()=>{
  const previous={mentions:{rows:mentions.rows.slice(0,2)},youtube_comments:{rows:[{videoId:ids[0],comments:[{id:'old',text:'old',url:'https://youtube.com/'}],observedAt:'2026-10-01T00:00:00Z'}]}}
  const result=await collectYouTubeComments(env,async url=>new URL(url).searchParams.get('videoId')===ids[0]?new Response('',{status:403}):Response.json({items:[]}),previous,now)
  assert.equal(result.youtube_comments.rows[0].status,'unavailable')
  assert.equal(result.youtube_comments.rows[0].observedAt,'2026-10-01T00:00:00Z')
  assert.equal(result.youtube_comments.rows[0].comments[0].text,'old')
  assert.deepEqual(result.youtube_comments.rows[1].comments,[])
  assert.equal(result.youtube_comments.rows[1].status,'available')
  await collectYouTubeComments(env,async()=>assert.fail('failure cached'),{...previous,...result},now+1000)
})

test('invalid responses are rejected and cutoff, missing key and lifetime budget prevent requests',async()=>{
  const previous={mentions:{rows:mentions.rows.slice(0,1)}}
  const invalid=await collectYouTubeComments(env,async()=>Response.json({items:[item(ids[1])]}),previous,now)
  assert.equal(invalid.youtube_comments.rows[0].status,'unavailable')
  assert.equal(invalid.youtube_comments.rows[0].comments,undefined)
  const noRequest=async()=>assert.fail('unexpected request')
  const capped=await collectYouTubeComments(env,noRequest,{...previous,youtube_comments_status:{rows:[{totalAttempts:21}]}},now)
  assert.equal(capped.youtube_comments_status.rows[0].totalAttempts,21)
  assert.equal((await collectYouTubeComments({...env,YOUTUBE_API_KEY:''},noRequest,previous,now)).youtube_comments_status.rows[0].status,'unconfigured')
  assert.equal((await collectYouTubeComments({...env,REFRESH_UNTIL:'2026-01-01'},noRequest,previous,now)).youtube_comments_status.rows[0].status,'expired')
})
