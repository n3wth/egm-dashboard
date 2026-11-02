import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {handleAsk,askContext,askCards,askHistory,neutralCausalWording,renumberCitations,summedUniques,askFollowUps} from './ask.mjs'
import {geminiRunner} from './gemini.mjs'
const origin='https://egm.n3wth.com'
const user={id:'owner',status:'approved'}
const snapshot={generatedAt:'2026-10-28T00:00:00Z',queries:{traffic:{rows:[{views:100,rawMarkdown:'untrusted long body'}],source:{label:'GitHub traffic',executedAt:'2026-10-27T00:00:00Z',links:[{url:'javascript:alert(1)'},{url:'https://github.com/google/elephant-goldfish-model'}]}}}}
const request=(body={question:'How many views?'},headers={})=>new Request(origin+'/api/ask',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)})
function environment(changes=1) {
  return {APP_URL:origin,DB:{prepare(sql){return {bind(){return this},async first(){return {body:JSON.stringify(snapshot),generated_at:snapshot.generatedAt}},async run(){assert.match(sql,/INSERT INTO audit/);return {meta:{changes}}}}}},INFER:{async run(model,input){assert.equal(input.max_tokens,2048);assert.match(model,/^gemini-/);assert.ok(!input.messages[1].content.includes('rawMarkdown'));return {response:'100 views [S1]'}}}}
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
  assert.equal(body.answer,'100 views [1]')
  assert.equal(body.sources[0].url,'https://github.com/google/elephant-goldfish-model')
  assert.equal(body.snapshotAt,snapshot.generatedAt)
  assert.equal(result.headers.get('cache-control'),'private, no-store')
})
test('Markdown responses retain evidence rules and request readable formatting',async()=>{
  const env=environment()
  env.INFER.run=async(_,input)=>{
    assert.match(input.messages[0].content,/untrusted data/)
    assert.match(input.messages[1].content,/Markdown.*paragraphs, headings and lists/)
    assert.equal(input.messages[2].role,'user')
    return {response:'## Ideas\n\n- Test a first run [S1]'}
  }
  const response=await handleAsk(request({question:'Growth ideas',format:'markdown'}),env,user)
  assert.match((await response.json()).answer,/^- /m)
})
test('atomic quota rejects before inference',async()=>{
  const env=environment(0)
  env.INFER.run=()=>assert.fail('must not infer')
  assert.equal((await handleAsk(request(),env,user)).status,429)
})
test('allows 200 questions per user per rolling hour',async()=>{
  const db=new DatabaseSync(':memory:')
  db.exec('CREATE TABLE audit (id TEXT, user_id TEXT, action TEXT, actor TEXT, created_at TEXT)')
  const env=environment()
  const prepare=env.DB.prepare
  env.DB.prepare=sql=>sql.startsWith('INSERT')?{bind(...args){return {async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}}}}}:prepare(sql)
  const now=Date.parse('2026-10-28T12:00:00Z')
  const insert=db.prepare("INSERT INTO audit VALUES (?,?,'ask.request',?,?)")
  for(let i=0;i<199;i++)insert.run(String(i),user.id,user.id,new Date(now-1000).toISOString())
  insert.run('other','another-user','another-user',new Date(now-1000).toISOString())
  insert.run('old',user.id,user.id,new Date(now-3600001).toISOString())
  assert.equal((await handleAsk(request(),env,user,{now})).status,200)
  assert.equal((await handleAsk(request(),env,user,{now})).status,429)
  db.close()
})
test('combined citation IDs retain all corresponding validated sources',async()=>{
  const env=environment()
  const prepare=env.DB.prepare
  env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT body'))statement.first=async()=>({body:JSON.stringify({...snapshot,queries:{...snapshot.queries,reach:{rows:[{stars:42}],source:{label:'Stars'}}}}),generated_at:snapshot.generatedAt});return statement}
  env.INFER.run=async()=>({response:'Observed [S1, S2], not [S999]'})
  const result=await (await handleAsk(request(),env,user)).json()
  assert.deepEqual(result.sources.map(source=>source.id),['1','2'])
  assert.equal(result.answer,'Observed [1][2], not')
})
test('missing AI or snapshot and bounded timeout are explicit',async()=>{
  const env=environment()
  assert.equal((await handleAsk(request(),{...env,INFER:null},user)).status,503)
  env.INFER.run=()=>new Promise(()=>{})
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
  assert.equal(cards[0].tab,'/overview')
  assert.equal(cards[2].tab,'/mentions')
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
  env.INFER.run=async(_,input)=>{
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
  env.INFER.run=async(_,input)=>{
    assert.equal(input.stream,true)
    return new ReadableStream({start(controller){push=text=>controller.enqueue(new TextEncoder().encode(text))}})
  }
  const result=await handleAsk(request({question:'views?',stream:true}),env,user)
  assert.match(result.headers.get('content-type'),/application\/x-ndjson/)
  const reader=result.body.getReader(),decoder=new TextDecoder()
  push('data: {"respon')
  push('se":"100 "}\n\n')
  let head=''
  while(!head.includes('"delta"'))head+=decoder.decode((await reader.read()).value)
  const steps=head.trim().split('\n').map(JSON.parse)
  assert.deepEqual(steps.at(-1),{type:'delta',text:'100 '})
  assert.deepEqual(steps.slice(0,-1).map(step=>[step.id,step.status,step.detail]),[['context','active',undefined],['context','done','1 sources'],['answer','active',undefined]])
  push('data: {"response":"views [S1]"}\r\n\r\ndata: [DONE]\n\n')
  let rest=''
  while(true){const item=await reader.read();if(item.done)break;rest+=decoder.decode(item.value)}
  const events=rest.trim().split('\n').map(JSON.parse)
  assert.ok(!events.some(event=>event.type==='step'))
  assert.equal(events.at(-1).type,'result')
  assert.equal(events.at(-1).answer,'100 views [1]')
  assert.equal(events.at(-1).sources[0].id,'1')
  assert.equal(quota,1)
})
test('answers cut off by the token limit carry an incomplete note in both modes',async()=>{
  const note='This answer reached the length limit and may be incomplete.'
  const candidate=finishReason=>({candidates:[{content:{parts:[{text:'100 views [S1]'}]},finishReason}]})
  const provider=finishReason=>{
    const env=environment()
    env.INFER=geminiRunner({GEMINI_API_KEY:'k'},async url=>url.includes('alt=sse')?new Response('data: '+JSON.stringify(candidate(finishReason))+'\n\n'):Response.json(candidate(finishReason)))
    return env
  }
  const plain=async finishReason=>(await handleAsk(request(),provider(finishReason),user)).json()
  const streamed=async finishReason=>{
    const response=await handleAsk(request({question:'How many views?',stream:true}),provider(finishReason),user)
    return (await response.text()).trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.type==='result')
  }
  for(const ask of [plain,streamed]) {
    const cut=await ask('MAX_TOKENS')
    assert.equal(cut.answer,'100 views [1]')
    assert.equal(cut.coverageNote,note)
    assert.equal((await ask('STOP')).coverageNote,null)
  }
})
test('stream emits github step around the live check reflecting real toolStatus',async()=>{
  const env={...environment(),GITHUB_TOKEN:'test-only'}
  env.INFER.run=async()=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"response":"777 [S1]"}\n\ndata: [DONE]\n\n'));controller.close()}})
  const live=await handleAsk(request({question:'stars now',stream:true}),env,user,{request:async()=>Response.json({full_name:'google/elephant-goldfish-model',stargazers_count:777,forks_count:1,open_issues_count:1})})
  const events=(await live.text()).trim().split('\n').map(JSON.parse)
  assert.deepEqual(events.map(event=>event.type),['step','step','step','step','step','delta','result'])
  assert.deepEqual(events.slice(0,5).map(step=>[step.id,step.status,step.detail]),[['context','active',undefined],['context','done','1 sources'],['github','active',undefined],['github','done','Live'],['answer','active',undefined]])
  assert.equal(events[2].label,'Checking GitHub live')
  assert.equal(events.at(-1).toolStatus.status,'live')
  const down=await handleAsk(request({question:'stars now',stream:true}),env,user,{request:async()=>new Response(null,{status:500})})
  const downSteps=(await down.text()).trim().split('\n').map(JSON.parse).filter(event=>event.id==='github')
  assert.equal(downSteps[1].detail,'Unavailable, saved data shown')
})
test('stream timeout emits safe terminal error and cancels upstream reader',async()=>{
  const env=environment()
  let cancelled=false
  env.INFER.run=async()=>new ReadableStream({cancel(){cancelled=true}})
  const result=await handleAsk(request({question:'views?',stream:true}),env,user,{timeoutMs:2})
  const events=(await result.text()).trim().split('\n').map(JSON.parse)
  assert.deepEqual(events.at(-1),{type:'error',error:'ask_timeout'})
  assert.ok(events.slice(0,-1).every(event=>event.type==='step'))
  assert.equal(cancelled,true)
})
test('client stream cancellation cancels the provider',async()=>{
  const env=environment()
  let cancelled=false
  env.INFER.run=async()=>new ReadableStream({cancel(){cancelled=true}})
  const result=await handleAsk(request({question:'views?',stream:true}),env,user)
  await result.body.cancel()
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(cancelled,true)
})
test('PostHog AI events record successful and failed generations without the snapshot',async()=>{
  const sent=[],pending=[]
  const options={fetcher:async(_,init)=>{sent.push(JSON.parse(init.body));return new Response('',{status:200})},waitUntil:promise=>pending.push(promise)}
  const env=environment()
  env.POSTHOG_PROJECT_TOKEN='phc_test';env.POSTHOG_HOST='https://us.i.posthog.com'
  env.INFER.run=async(_,input)=>{input.onUsage?.({promptTokenCount:12,candidatesTokenCount:5});input.onFirstText?.();return {response:'100 views [S1]'}}
  assert.equal((await handleAsk(request({question:'How many views?',history:[{question:'hi',answer:'hello'}]}),env,user,options)).status,200)
  await Promise.all(pending)
  assert.equal(sent.length,1)
  const recorded=sent[0].batch[0]
  const ok=recorded.properties
  assert.equal(recorded.event,'$ai_generation');assert.equal(recorded.distinct_id,'owner')
  assert.equal(ok.$ai_input_tokens,12);assert.equal(ok.$ai_is_error,false)
  assert.deepEqual(ok.$ai_input.map(turn=>turn.content),['hi','hello','How many views?'])
  assert.ok(!JSON.stringify(sent[0]).includes('rawMarkdown'))
  env.INFER.run=async()=>{throw Error('provider_failed')}
  assert.equal((await handleAsk(request({question:'How many views?'}),env,user,options)).status,503)
  await Promise.all(pending)
  assert.equal(sent.at(-1).batch[0].properties.$ai_is_error,true);assert.equal(sent.at(-1).batch[0].properties.$ai_error,'ask_unavailable')
})
test('causal verbs before measured numbers become neutral, other uses are untouched',()=>{
  assert.equal(neutralCausalWording('YouTube is a referrer, driving 4,792 views [S12].'),'YouTube is a referrer, accounting for 4,792 views [S12].')
  assert.equal(neutralCausalWording('Drove about 3 clones; the post led to 12 stars and resulted in more than 5 forks.'),'Accounted for about 3 clones; the post coincided with 12 stars and coincided with more than 5 forks.')
  assert.equal(neutralCausalWording('Try driving traffic to the README.'),'Try driving traffic to the README.')
})
test('cited sources are renumbered without gaps in first-citation order, cards last',()=>{
  const result=renumberCitations('Video [S12] and site [S14, S12].',[{id:'S3',label:'card'},{id:'S12'},{id:'S14'},{id:'S20'}],[{sourceId:'S3'},{sourceId:'S12'}])
  assert.equal(result.answer,'Video [1] and site [2][1].')
  assert.deepEqual(result.sources.map(source=>[source.id,source.label]),[['1',undefined],['2',undefined],['3','card']])
  assert.deepEqual(result.cards.map(card=>card.sourceId),['3','1'])
})
test('share metrics carry a percent unit and readable labels',()=>{
  const context=askContext({queries:{website_contribution:{rows:[{rank:4,viewShare:0.042,topTenShare:0.096,websiteViews:2746}]}}},'website')
  const metrics=askCards(context,'website')[0].metrics
  assert.deepEqual(metrics.map(metric=>[metric.label,metric.unit]),[['Referrer rank',undefined],['Share of repo views','percent'],['Share of top-10 referrer views','percent'],['egm.dev referral views',undefined]])
})
test('prompt requires neutral verbs and measurable experiment criteria',async()=>{
  const env=environment()
  let system
  env.INFER.run=async(_,input)=>{system=input.messages[0].content;return {response:'100 views [S1]'}}
  await handleAsk(request(),env,user)
  assert.match(system,/never drove, caused, led to or resulted in/)
  assert.match(system,/current cited value as the baseline, the observation window/)
  assert.match(system,/rolling 14-day window/)
})
test('summed unique counts are detected per sentence',()=>{
  assert.equal(summedUniques('LinkedIn sent 2,507 unique visitors (1,718 + 789) [S1].'),true)
  assert.equal(summedUniques('LinkedIn sent 1,718 unique visitors. Views were 1,969 + 882 overall.'),false)
  assert.equal(summedUniques('Both apps sent a combined 3,429 unique visitors.'),true)
  assert.equal(summedUniques('The combined unique count is unknown.'),false)
  assert.equal(summedUniques('The repo had a total of 14,613 unique visitors.'),false)
  assert.equal(summedUniques('They sent 7,178 combined unique visitors.'),true)
})
test('cards only come from cited records and sources lead with dataset names',async()=>{
  const env=environment()
  const prepare=env.DB.prepare
  env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT body'))statement.first=async()=>({body:JSON.stringify({...snapshot,queries:{...snapshot.queries,reach:{rows:[{stars:42}],source:{label:'GitHub REST API'}}}}),generated_at:snapshot.generatedAt});return statement}
  const ids=askContext({...snapshot,queries:{...snapshot.queries,reach:{rows:[{stars:42}],source:{label:'GitHub REST API'}}}},'Repository reach').records.map(record=>[record.queryId,record.id])
  const reachId=ids.find(([queryId])=>queryId==='reach')[1]
  env.INFER.run=async()=>({response:`Stars were 42 [${reachId}].`})
  const result=await (await handleAsk(request({question:'Repository reach'}),env,user)).json()
  assert.deepEqual(result.cards.map(card=>card.queryId),['reach'])
  assert.equal(result.sources[0].label,'Repository reach')
  assert.equal(result.sources[0].provider,'GitHub REST API')
})
test('follow-ups come from cited data and skip questions already asked',()=>{
  assert.deepEqual(askFollowUps(['reach'],['How many stars?']),['How has EGM star growth changed?','What are the clearest growth opportunities?'])
  assert.deepEqual(askFollowUps(['reach','traffic'],['how has egm star growth changed?']),['Which channels bring visitors to EGM?','What are the clearest growth opportunities?'])
  assert.deepEqual(askFollowUps(['unmapped'],[]),['What are the clearest growth opportunities?','Which channels bring visitors to EGM?'])
})
test('measurement limits are scoped to experiments, not short answers',async()=>{
  const env=environment()
  let system
  env.INFER.run=async(_,input)=>{system=input.messages[0].content;return {response:'100 views [S1]'}}
  await handleAsk(request(),env,user)
  assert.match(system,/Do not add measurement limits to a short factual answer/)
})
