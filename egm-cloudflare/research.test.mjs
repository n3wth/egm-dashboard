import test from 'node:test'
import assert from 'node:assert/strict'
import {collectResearch,peerRepos} from './research.mjs'
test('peer growth uses the stored observation and checks README evidence',async()=>{
  let writes=0
  const env={GITHUB_TOKEN:'test',DB:{prepare(){return {bind(){return {first:async()=>({stars:100,observed_at:'2026-10-28T00:00:00Z'}),run:async()=>{writes++}}}}}}}
  const result=await collectResearch(env,async url=>{
    if(url.includes('/search/')) return Response.json({incomplete_results:false,items:[]})
    if(url.endsWith('/readme')) return Response.json({content:btoa('# Install\nhttps://youtu.be/example'),html_url:'https://github.com/example/README.md'})
    return Response.json({html_url:'https://github.com/example',description:'Test peer',stargazers_count:110,forks_count:10,created_at:'2025-01-01T00:00:00Z',pushed_at:'2026-10-28T00:00:00Z'})
  })
  assert.equal(writes,peerRepos.length)
  assert.ok(result.peers.rows.every(r=>r.observedDelta===10 && r.quickStart && r.demo))
  assert.equal(result.emerging.rows.length,0)
  assert.match(result.emerging.source.caveats.join(' '),/not GitHub Trending/)
})
test('research source failure cannot produce success-looking peer rows',async()=>{
  await assert.rejects(collectResearch({GITHUB_TOKEN:'test'},async()=>new Response('{}',{status:403})),/Research source failed/)
})
