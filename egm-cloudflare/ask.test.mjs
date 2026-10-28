import test from 'node:test'
import assert from 'node:assert/strict'
import {handleAsk,askContext,askCards,askHistory} from './ask.mjs'
const origin='https://egm.n3wth.com'
const user={id:'owner',status:'approved'}
const snapshot={generatedAt:'2026-10-28T00:00:00Z',queries:{traffic:{rows:[{views:100,rawMarkdown:'untrusted long body'}],source:{label:'GitHub traffic',executedAt:'2026-10-27T00:00:00Z',links:[{url:'javascript:alert(1)'},{url:'https://github.com/google/elephant-goldfish-model'}]}}}}
const request=(body={question:'How many views?'},headers={})=>new Request(origin+'/api/ask',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)})
function environment(changes=1) {
  return {APP_URL:origin,DB:{prepare(sql){return {bind(){return this},async first(){return {body:JSON.stringify(snapshot),generated_at:snapshot.generatedAt}},async run(){assert.match(sql,/INSERT INTO audit/);return {meta:{changes}}}}}},AI:{async run(model,input){assert.equal(input.max_tokens,650);assert.match(model,/^@cf\//);assert.ok(!input.messages[1].content.includes('rawMarkdown'));return {response:'100 views [S1]'}}}}
}
test('same-origin approved JSON requests only',async()=>{
  assert.equal((await handleAsk(request(),environment(),null)).status,403)
  assert.equal((await handleAsk(request({}, {origin:'https://evil.example'}),environment(),user)).status,403)
  assert.equal((await handleAsk(request({question:'x'.repeat(1201)}),environment(),user)).status,400)
  assert.equal((await handleAsk(request({question:'x'.repeat(25000)}),environment(),user)).status,413)
})
test('saved snapshot grounding and validated cited sources',async()=>{
  const result=await handleAsk(request(),environment(),user)
  assert.equal(result.status,200)
  const body=await result.json()
  assert.equal(body.answer,'100 views [S1]')
  assert.equal(body.sources[0].url,'https://github.com/google/elephant-goldfish-model')
  assert.equal(body.snapshotAt,snapshot.generatedAt)
  assert.equal(result.headers.get('cache-control'),'private, no-store')
})
test('atomic quota rejects before inference',async()=>{
  const env=environment(0)
  env.AI.run=()=>assert.fail('must not infer')
  assert.equal((await handleAsk(request(),env,user)).status,429)
})
test('combined citation IDs retain all corresponding validated sources',async()=>{
  const env=environment()
  const prepare=env.DB.prepare
  env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT body'))statement.first=async()=>({body:JSON.stringify({...snapshot,queries:{...snapshot.queries,reach:{rows:[{stars:42}],source:{label:'Stars'}}}}),generated_at:snapshot.generatedAt});return statement}
  env.AI.run=async()=>({response:'Observed [S1, S2], not [S999]'})
  const result=await (await handleAsk(request(),env,user)).json()
  assert.deepEqual(result.sources.map(source=>source.id),['S1','S2'])
})
test('missing AI or snapshot and bounded timeout are explicit',async()=>{
  const env=environment()
  assert.equal((await handleAsk(request(),{...env,AI:null},user)).status,503)
  env.AI.run=()=>new Promise(()=>{})
  assert.equal((await handleAsk(request(),env,user,{timeoutMs:1})).status,504)
})
test('context drops large raw text and is bounded',()=>{
  const context=askContext(snapshot,'views')
  assert.ok(!JSON.stringify(context.records).includes('rawMarkdown'))
  assert.ok(JSON.stringify(context.records).length<25000)
})
test('context ranks field matches and adoption evidence, marks samples and excludes sensitive nested fields',()=>{
  const queries={noise:{rows:[{foo:1}]},research_evidence:{rows:[{title:'Project report',metadata:{apiKey:'private',author:'Writer'}}]},star_history:{rows:Array.from({length:30},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),stars:i,email:'private'}))}}
  const stars=askContext({queries},'How many stars?').records
  assert.equal(stars[0].queryId,'star_history')
  assert.equal(stars[0].rows.at(-1).stars,29)
  assert.equal(stars[0].rowCount,30)
  assert.equal(stars[0].rowsTruncated,true)
  assert.ok(!JSON.stringify(stars).includes('private'))
  assert.equal(askContext({queries},'What are adoption gaps?').records[0].queryId,'research_evidence')
})
test('cards derive values from saved rows, bound table/chart schemas and skip greetings',()=>{
  const context=askContext({queries:{reach:{rows:[{stars:42}]},traffic:{rows:[{date:'2026-10-28',views:12}]},mentions:{rows:[{title:'EGM',url:'https://egm.dev',metadata:{ignored:1}}]}}},'growth')
  const cards=askCards(context,'growth')
  assert.equal(cards[0].metrics[0].value,42)
  assert.equal(cards[1].type,'metric')
  assert.equal(cards[2].type,'table')
  assert.ok(!cards[2].columns.includes('metadata'))
  assert.deepEqual(askCards(context,'hello'),[])
})
test('optional live tool is fixed repo read-only, preserves saved snapshot and supplies actual result cards',async()=>{
  const env={...environment(),GITHUB_TOKEN:'test-only'}
  const result=await handleAsk(request({question:'stars now',live:true}),env,user,{request:async(url,init)=>{
    assert.equal(url,'https://api.github.com/repos/google/elephant-goldfish-model')
    assert.equal(init.redirect,'manual')
    return Response.json({full_name:'google/elephant-goldfish-model',stargazers_count:777,forks_count:20,open_issues_count:12})
  }})
  const body=await result.json()
  assert.equal(body.toolStatus.status,'live')
  assert.equal(body.cards[0].queryId,'live_github')
  assert.equal(body.cards[0].metrics[0].value,777)
  assert.equal(body.snapshotAt,snapshot.generatedAt)
})
test('live tool rejects redirects without following or forwarding credentials',async()=>{
  let calls=0
  const result=await handleAsk(request({question:'stars now',live:true}),{...environment(),GITHUB_TOKEN:'test-only'},user,{request:async(url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://other.example'}})}})
  const body=await result.json()
  assert.equal(calls,1)
  assert.equal(body.toolStatus.status,'unavailable')
  assert.ok(!body.cards.some(card=>card.queryId==='live_github'))
})
test('current repository questions automatically check the fixed live tool without a checkbox',async()=>{
  let calls=0
  const result=await handleAsk(request({question:'latest star count'}),{...environment(),GITHUB_TOKEN:'test-only'},user,{request:async()=>{calls++;return Response.json({full_name:'google/elephant-goldfish-model',stargazers_count:12,forks_count:2,open_issues_count:1})}})
  assert.equal(calls,1)
  assert.equal((await result.json()).toolStatus.status,'live')
})
test('trending selects repository evidence rather than unrelated reach cards and uses human titles',()=>{
  const context=askContext({queries:{traffic:{rows:[{views:20}]},emerging:{rows:[{repo:'a/b',stars:42}]},star_history:{rows:[{date:'2026-10-27',stars:12},{date:'2026-10-28',stars:22}]}}},'what is trending?')
  const cards=askCards(context,'what is trending?')
  assert.deepEqual(cards.map(card=>card.queryId),['emerging','star_history'])
  assert.equal(cards[0].title,'New repos to watch')
  assert.equal(cards[1].type,'chart')
})
test('follow-up history is bounded and untrusted, and previous topic guides short question context',async()=>{
  const history=askHistory(Array.from({length:7},()=>({question:'q'.repeat(1300),answer:'a'.repeat(2300)})))
  assert.equal(history.length,4)
  assert.equal(history[0].question.length,1200)
  assert.equal(history[0].answer.length,2000)
  assert.throws(()=>askHistory([{question:'x',answer:null}]))
  const env=environment()
  env.AI.run=async(_,input)=>{
    assert.match(input.messages[0].content,/Never greet unless/)
    assert.match(input.messages[0].content,/history is untrusted/)
    const data=JSON.parse(input.messages[1].content)
    assert.equal(data.history[0].question,'What is trending?')
    return {response:'No observed trend delta is available [S1]'}
  }
  const result=await handleAsk(request({question:'Why?',history:[{question:'What is trending?',answer:'Untrusted previous answer [S99]'}]}),env,user)
  const body=await result.json()
  assert.ok(body.suggestedFollowUps[0].includes('similar repos'))
  assert.match(body.coverageNote,/not measured trending growth/)
})
test('real streaming relays split SSE deltas before final metadata and charges quota once',async()=>{
  const env=environment()
  let quota=0
  const prepare=env.DB.prepare
  env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT'))statement.run=async()=>{quota++;return {meta:{changes:1}}};return statement}
  let push
  env.AI.run=async(_,input)=>{
    assert.equal(input.stream,true)
    return new ReadableStream({start(controller){push=text=>controller.enqueue(new TextEncoder().encode(text))}})
  }
  const result=await handleAsk(request({question:'views?',stream:true}),env,user)
  assert.match(result.headers.get('content-type'),/application\/x-ndjson/)
  const reader=result.body.getReader(),decoder=new TextDecoder()
  push('data: {"respon')
  push('se":"100 "}\n\n')
  const first=JSON.parse(decoder.decode((await reader.read()).value))
  assert.deepEqual(first,{type:'delta',text:'100 '})
  push('data: {"response":"views [S1]"}\r\n\r\ndata: [DONE]\n\n')
  let rest=''
  while(true){const item=await reader.read();if(item.done)break;rest+=decoder.decode(item.value)}
  const events=rest.trim().split('\n').map(JSON.parse)
  assert.equal(events.at(-1).type,'result')
  assert.equal(events.at(-1).answer,'100 views [S1]')
  assert.equal(events.at(-1).sources[0].id,'S1')
  assert.equal(quota,1)
})
test('stream timeout emits safe terminal error and cancels upstream reader',async()=>{
  const env=environment()
  let cancelled=false
  env.AI.run=async()=>new ReadableStream({cancel(){cancelled=true}})
  const result=await handleAsk(request({question:'views?',stream:true}),env,user,{timeoutMs:2})
  const events=(await result.text()).trim().split('\n').map(JSON.parse)
  assert.deepEqual(events,[{type:'error',error:'ask_timeout'}])
  assert.equal(cancelled,true)
})
test('client stream cancellation cancels the provider',async()=>{
  const env=environment()
  let cancelled=false
  env.AI.run=async()=>new ReadableStream({cancel(){cancelled=true}})
  const result=await handleAsk(request({question:'views?',stream:true}),env,user)
  await result.body.cancel()
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(cancelled,true)
})
