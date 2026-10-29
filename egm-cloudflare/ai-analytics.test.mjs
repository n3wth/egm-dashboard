import test from 'node:test'
import assert from 'node:assert/strict'
import {aiGenerationEvent,captureAiGeneration} from './ai-analytics.mjs'

const env={POSTHOG_PROJECT_TOKEN:'phc_test',POSTHOG_HOST:'https://us.i.posthog.com'}
const data={traceId:'t1',userId:'user_1',model:'gemini-flash-lite-latest',input:[{role:'user',content:'q'}],output:'a [S1]',usage:{promptTokenCount:10,candidatesTokenCount:4},latencyMs:2400,firstTokenMs:900,stream:true,temperature:0.1,maxTokens:1024,contextSources:5,liveGithub:'cached'}

test('builds a $ai_generation event with tokens, latency and no snapshot context',()=>{
  const event=aiGenerationEvent(env,data)
  assert.equal(event.event,'$ai_generation');assert.equal(event.distinct_id,'user_1');assert.equal(event.api_key,'phc_test')
  const p=event.properties
  assert.equal(p.$ai_provider,'gemini');assert.equal(p.$ai_model,'gemini-flash-lite-latest')
  assert.equal(p.$ai_input_tokens,10);assert.equal(p.$ai_output_tokens,4)
  assert.equal(p.$ai_latency,2.4);assert.equal(p.$ai_time_to_first_token,0.9);assert.equal(p.$ai_is_error,false)
  assert.deepEqual(p.$ai_output_choices,[{role:'assistant',content:'a [S1]'}])
  assert.equal(p.$geoip_disable,true)
  assert.ok(!JSON.stringify(p).includes('snapshot'))
})
test('errors are flagged and carry no output',()=>{
  const p=aiGenerationEvent(env,{...data,output:undefined,error:'ask_timeout'}).properties
  assert.equal(p.$ai_is_error,true);assert.equal(p.$ai_error,'ask_timeout');assert.equal('$ai_output_choices' in p,false)
})
test('posts to the allowed PostHog host and swallows failures',async()=>{
  let seen
  assert.equal(await captureAiGeneration(env,data,async(url,init)=>{seen={url,init};return new Response('',{status:200})}),true)
  assert.equal(seen.url,'https://us.i.posthog.com/i/v0/e/');assert.equal(seen.init.redirect,'manual')
  assert.equal(JSON.parse(seen.init.body).event,'$ai_generation')
  assert.equal(await captureAiGeneration(env,data,async()=>{throw Error('down')}),false)
})
test('does nothing without a token or on an unapproved host',async()=>{
  const never=async()=>assert.fail('must not send')
  assert.equal(await captureAiGeneration({},data,never),false)
  assert.equal(await captureAiGeneration({...env,POSTHOG_HOST:'https://evil.example'},data,never),false)
  assert.equal(await captureAiGeneration({...env,POSTHOG_HOST:'http://us.i.posthog.com'},data,never),false)
})
