import test from 'node:test'
import assert from 'node:assert/strict'
import {AskTransport,answerText,askHistory,messageResult,messageText} from './ask-transport.mjs'

const user=(id,text)=>({id,role:'user',parts:[{type:'text',text}]})
const assistant=(id,text,result={answer:text})=>({id,role:'assistant',parts:[{type:'text',text},...(result?[{type:'data-result',data:result}]:[])]})
const ndjson=events=>new Response(events.map(event=>JSON.stringify(event)).join('\n')+'\n',{headers:{'content-type':'application/x-ndjson'}})
const read=async stream=>{const chunks=[];const reader=stream.getReader();while(true){const {done,value}=await reader.read();if(done)return chunks;chunks.push(value)}}

test('history keeps the last four completed pairs and excludes the new question',()=>{
  const messages=[]
  for(let i=0;i<6;i++)messages.push(user(`u${i}`,`q${i}`),assistant(`a${i}`,`a${i}`))
  messages.push(user('u6','q6'))
  assert.deepEqual(askHistory(messages).map(pair=>pair.question),['q2','q3','q4','q5'])
})
test('history skips answers that did not complete',()=>{
  assert.deepEqual(askHistory([user('u0','q0'),assistant('a0','partial',null),user('u1','q1')]),[])
})
test('maps NDJSON deltas and result to UI message chunks',async()=>{
  let body
  const outcomes=[]
  const transport=new AskTransport({fetch:async(_url,init)=>{body=JSON.parse(init.body);return ndjson([{type:'delta',text:'Hi '},{type:'delta',text:'there'},{type:'result',answer:'Hi there',cards:[1,2,3,4],suggestedFollowUps:['Next?']}])},onOutcome:value=>outcomes.push(value)})
  const chunks=await read(await transport.sendMessages({messages:[user('u0',' Hello ')],abortSignal:undefined}))
  assert.equal(body.question,'Hello')
  assert.deepEqual(chunks.map(chunk=>chunk.type),['start','text-start','text-delta','text-delta','text-end','data-result','finish'])
  const result=chunks.find(chunk=>chunk.type==='data-result').data
  assert.equal(result.cards.length,3)
  assert.deepEqual(result.sources,[])
  assert.deepEqual(outcomes,['submitted','completed'])
})
test('maps step events to data-step parts keyed by step id',async()=>{
  const transport=new AskTransport({fetch:async()=>ndjson([{type:'step',id:'context',label:'Reading saved dashboard data',status:'active'},{type:'step',id:'context',label:'Reading saved dashboard data',status:'done',detail:'3 sources'},{type:'delta',text:'Hi'},{type:'result',answer:'Hi'}])})
  const chunks=await read(await transport.sendMessages({messages:[user('u0','q')]}))
  const steps=chunks.filter(chunk=>chunk.type==='data-step')
  assert.deepEqual(steps.map(chunk=>[chunk.id,chunk.data.status,chunk.data.detail]),[['context','active',undefined],['context','done','3 sources']])
  assert.equal(chunks.indexOf(steps[1])<chunks.findIndex(chunk=>chunk.type==='text-start'),true)
})
test('emits the answer text when the result arrives without deltas',async()=>{
  const transport=new AskTransport({fetch:async()=>ndjson([{type:'result',answer:'Only result'}])})
  const chunks=await read(await transport.sendMessages({messages:[user('u0','q')]}))
  assert.equal(chunks.find(chunk=>chunk.type==='text-delta').delta,'Only result')
})
test('stream errors become an error chunk after partial text',async()=>{
  const transport=new AskTransport({fetch:async()=>ndjson([{type:'delta',text:'Part'},{type:'error',error:'ask_timeout'}])})
  const chunks=await read(await transport.sendMessages({messages:[user('u0','q')]}))
  assert.equal(chunks.at(-1).type,'error')
  assert.match(chunks.at(-1).errorText,/too long/)
})
test('HTTP failures reject with the user-facing message',async()=>{
  const transport=new AskTransport({fetch:async()=>new Response('',{status:429})})
  await assert.rejects(transport.sendMessages({messages:[user('u0','q')]}),/hourly question limit/)
})
test('message helpers read text and result parts',()=>{
  const message=assistant('a','Answer',{answer:'Answer',cards:[]})
  assert.equal(messageText(message),'Answer')
  assert.equal(messageResult(message).answer,'Answer')
})
test('final result answer wins over streamed deltas for display and history',()=>{
  const message=assistant('a','raw [1] text',{answer:'Clean text'})
  assert.equal(answerText(message),'Clean text')
  assert.equal(askHistory([user('u','q'),message,user('u2','q2')])[0].answer,'Clean text')
})
test('a stream that ends without a result becomes an error chunk',async()=>{
  const transport=new AskTransport({fetch:async()=>ndjson([{type:'delta',text:'Part'}])})
  const chunks=await read(await transport.sendMessages({messages:[user('u0','q')]}))
  assert.match(chunks.at(-1).errorText,/before completion/)
})
test('abort reports stopped once and emits no error chunk',async()=>{
  const outcomes=[]
  const controller=new AbortController()
  const transport=new AskTransport({fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"type":"delta","text":"x"}\n'))}}),{headers:{'content-type':'application/x-ndjson'}}),onOutcome:value=>outcomes.push(value)})
  const stream=await transport.sendMessages({messages:[user('u0','q')],abortSignal:controller.signal})
  const reading=read(stream)
  await new Promise(resolve=>setTimeout(resolve,10))
  controller.abort()
  const chunks=await reading
  assert.equal(chunks.some(chunk=>chunk.type==='error'),false)
  assert.deepEqual(outcomes,['submitted','stopped'])
})

test('linkCitations links only known source markers', async () => {
  const {linkCitations}=await import('./ask-transport.mjs')
  assert.equal(linkCitations('Up [1], not [9], kept [2](x).',[{id:'1'},{id:'2'}],'m:1'),'Up [1](#ask-cite-m1-1), not [9], kept [2](x).')
  assert.equal(linkCitations('No [1].',[],'m'),'No [1].')
})
