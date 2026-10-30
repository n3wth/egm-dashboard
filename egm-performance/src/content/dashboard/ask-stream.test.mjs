import test from 'node:test'
import assert from 'node:assert/strict'
import {consumeAskStream} from './ask-stream.mjs'

const fromChunks=chunks=>new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close()}})
test('preserves JSON and UTF-8 split across arbitrary network chunks',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type:'delta',text:'Goldfish 🐟'})+'\n'+JSON.stringify({type:'result',answer:'Goldfish 🐟',cards:[]}))
  const events=[]
  const result=await consumeAskStream(fromChunks([...bytes].map(byte=>Uint8Array.of(byte))),event=>events.push(event))
  assert.equal(events[0].text,'Goldfish 🐟')
  assert.equal(result.answer,'Goldfish 🐟')
  assert.equal(events.length,2)
})
test('retains delivered partial tokens but rejects an error instead of completing',async()=>{
  const events=[]
  const stream=fromChunks([new TextEncoder().encode('{"type":"delta","text":"Partial"}\n{"type":"error","error":"ask_timeout"}\n')])
  await assert.rejects(consumeAskStream(stream,event=>events.push(event)),/too long/)
  assert.deepEqual(events,[{type:'delta',text:'Partial'}])
})
test('rejects a truncated response without a terminal result',async()=>{
  await assert.rejects(consumeAskStream(fromChunks([new TextEncoder().encode('{"type":"delta","text":"Partial"}\n')]),()=>{}),/before completion/)
})
test('forwards step events in order and updates by id',async()=>{
  const events=[]
  const lines=[{type:'step',id:'context',label:'Reading saved dashboard data',status:'active'},{type:'step',id:'context',label:'Reading saved dashboard data',status:'done',detail:'6 sources'},{type:'delta',text:'Hi'},{type:'result',answer:'Hi'}]
  await consumeAskStream(fromChunks([new TextEncoder().encode(lines.map(line=>JSON.stringify(line)).join('\n'))]),event=>events.push(event))
  assert.deepEqual(events.slice(0,2),lines.slice(0,2))
  assert.equal(events.length,4)
})
test('ignores malformed step events and unknown event types',async()=>{
  const events=[]
  const lines=[{type:'step',id:'context',status:'active'},{type:'step',id:'context',label:'x',status:'running'},{type:'step',id:7,label:'x',status:'done'},{type:'telemetry',ms:12},{type:'result',answer:'Hi'}]
  await consumeAskStream(fromChunks([new TextEncoder().encode(lines.map(line=>JSON.stringify(line)).join('\n'))]),event=>events.push(event))
  assert.deepEqual(events,[{type:'result',answer:'Hi'}])
})
test('abort cancels the pending reader',async()=>{
  const controller=new AbortController()
  let cancelled=false
  const stream=new ReadableStream({cancel(){cancelled=true}})
  const pending=consumeAskStream(stream,()=>{},{signal:controller.signal})
  controller.abort()
  await assert.rejects(pending,{name:'AbortError'})
  assert.equal(cancelled,true)
})
