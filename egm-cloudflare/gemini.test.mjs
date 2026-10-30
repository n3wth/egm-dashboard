import test from 'node:test'
import assert from 'node:assert/strict'
import {geminiRunner,GEMINI_MODEL} from './gemini.mjs'

const messages=[{role:'system',content:'rules'},{role:'system',content:'markdown'},{role:'user',content:'q1'},{role:'assistant',content:'a1'},{role:'user',content:'q2'}]
const sse=events=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\r\n\r\n').join(''),{headers:{'content-type':'text/event-stream'}})
const read=async stream=>{let text='';const reader=stream.getReader();const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)return text;text+=decoder.decode(value)}}

test('no key means no runner',()=>assert.equal(geminiRunner({}),null))
test('maps messages, sends the key in a header and returns the answer text',async()=>{
  let seen
  const runner=geminiRunner({GEMINI_API_KEY:'k'},async(url,init)=>{seen={url,init};return Response.json({candidates:[{content:{parts:[{text:'Hello '},{text:'there'},{thought:true,text:'hidden'}]}}]})})
  const result=await runner.run(GEMINI_MODEL,{messages,max_tokens:1024,temperature:0.1,stream:false})
  assert.deepEqual(result,{response:'Hello there'})
  assert.match(seen.url,/models\/gemini-flash-lite-latest:generateContent$/)
  assert.equal(seen.url.includes('k'),false)
  assert.equal(seen.init.headers['x-goog-api-key'],'k')
  const sent=JSON.parse(seen.init.body)
  assert.equal(sent.systemInstruction.parts[0].text,'rules\n\nmarkdown')
  assert.deepEqual(sent.contents.map(item=>item.role),['user','model','user'])
  assert.equal(sent.generationConfig.maxOutputTokens,1024)
  assert.equal('thinkingConfig' in sent.generationConfig,false)
})
test('streams Gemini events as response events ending in DONE',async()=>{
  const runner=geminiRunner({GEMINI_API_KEY:'k'},async url=>{assert.match(url,/streamGenerateContent\?alt=sse$/);return sse([{candidates:[{content:{parts:[{text:'A'}]}}]},{candidates:[{content:{parts:[{thought:true,text:'x'}]}}]},{candidates:[{content:{parts:[{text:'B'}]}}]}])})
  const text=await read(await runner.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:true}))
  assert.equal(text,'data: {"response":"A"}\n\ndata: {"response":"B"}\n\ndata: [DONE]\n\n')
})
test('provider errors in a stream become an error event',async()=>{
  const runner=geminiRunner({GEMINI_API_KEY:'k'},async()=>sse([{error:{message:'secret detail'}}]))
  const text=await read(await runner.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:true}))
  assert.match(text,/provider_failed/)
  assert.doesNotMatch(text,/secret detail/)
})
test('provider failures fail closed without leaking detail',async()=>{
  const failing=geminiRunner({GEMINI_API_KEY:'k'},async()=>new Response('quota detail',{status:429}))
  await assert.rejects(failing.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:false}),error=>error.message==='provider_failed')
  await assert.rejects(failing.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:true}),error=>error.message==='provider_failed')
})
test('reports usage and the first text through hooks for both modes',async()=>{
  const usage={promptTokenCount:7,candidatesTokenCount:3}
  const events=[{candidates:[{content:{parts:[{text:'A'}]}}]},{candidates:[{content:{parts:[{text:'B'}]}}],usageMetadata:usage}]
  let first=0,seen
  const runner=geminiRunner({GEMINI_API_KEY:'k'},async()=>sse(events))
  await read(await runner.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:true,onUsage:value=>{seen=value},onFirstText:()=>{first++}}))
  assert.equal(first,1);assert.deepEqual(seen,usage)
  seen=null
  const plain=geminiRunner({GEMINI_API_KEY:'k'},async()=>Response.json({candidates:[{content:{parts:[{text:'ok'}]}}],usageMetadata:usage}))
  await plain.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:false,onUsage:value=>{seen=value}})
  assert.deepEqual(seen,usage)
})
test('keeps reading when a chunk carries no text and when events split across chunks',async()=>{
  const encoder=new TextEncoder()
  const parts=['data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"x"}]}}]}\n\n','data: {"candidates":[{"content":{"par','ts":[{"text":"A"}]}}]}\n\n']
  const runner=geminiRunner({GEMINI_API_KEY:'k'},async()=>new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close()}})))
  assert.equal(await read(await runner.run(GEMINI_MODEL,{messages,max_tokens:10,temperature:0,stream:true})),'data: {"response":"A"}\n\ndata: [DONE]\n\n')
})
