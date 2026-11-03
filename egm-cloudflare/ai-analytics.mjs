// PostHog LLM analytics: one $ai_generation event per Ask request. The dashboard snapshot sent as
// system context is left out; only the conversation turns and the answer are recorded.
// App hosts redirect; AI events are dropped on the regular capture route and must use the AI batch path.
const ingestion={'us.i.posthog.com':'https://us.i.posthog.com','eu.i.posthog.com':'https://eu.i.posthog.com','us.posthog.com':'https://us.i.posthog.com','eu.posthog.com':'https://eu.i.posthog.com'}
const seconds=ms=>Number.isFinite(ms)?Math.round(ms)/1000:undefined
const count=(...values)=>{const value=values.find(item=>Number.isFinite(item));return value==null?undefined:Math.max(0,Math.round(value))}
function ingestionOrigin(value) {
  try {
    const host=new URL(value)
    if(host.protocol!=='https:'||host.username||host.password||host.port||host.search||host.hash||(host.pathname!=='/'&&host.pathname!==''))return null
    return ingestion[host.hostname]??null
  } catch {return null}
}

export function aiGenerationEvent(env,data) {
  const properties={
    $geoip_disable:true,
    $ai_trace_id:data.traceId,
    $ai_span_name:'ask',
    $ai_provider:'gemini',
    $ai_model:data.model,
    $ai_input:data.input,
    $ai_output_choices:data.error?undefined:[{role:'assistant',content:data.output}],
    $ai_input_tokens:count(data.usage?.promptTokenCount,data.usage?.prompt_token_count,data.usage?.input_tokens),
    $ai_output_tokens:count(data.usage?.candidatesTokenCount,data.usage?.candidates_token_count,data.usage?.output_tokens),
    $ai_latency:seconds(data.latencyMs),
    $ai_time_to_first_token:seconds(data.firstTokenMs),
    $ai_stream:data.stream===true,
    $ai_temperature:data.temperature,
    $ai_max_tokens:data.maxTokens,
    $ai_is_error:Boolean(data.error),
    $ai_error:data.error,
    context_sources:data.contextSources,
    live_github:data.liveGithub,
  }
  return {api_key:env.POSTHOG_PROJECT_TOKEN,distinct_id:data.userId,event:'$ai_generation',properties:Object.fromEntries(Object.entries(properties).filter(([,value])=>value!==undefined))}
}

async function postJson(url,body,fetcher) {
  const response=await fetcher(url,{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)})
  await response.body?.cancel?.()
  return response.ok
}

export async function capturePosthogEvent(env,event,fetcher=fetch) {
  try {
    const origin=ingestionOrigin(env.POSTHOG_HOST)
    if(!env.POSTHOG_PROJECT_TOKEN||!origin||!event?.event||event.distinct_id==null||event.distinct_id==='')return false
    const timestamp=new Date().toISOString()
    const properties=event.properties??{}
    // $ai_* events are not accepted on /i/v0/e/. PostHog ingests them at /i/v0/ai/batch/.
    if(String(event.event).startsWith('$ai_'))return await postJson(`${origin}/i/v0/ai/batch/`,{api_key:env.POSTHOG_PROJECT_TOKEN,sent_at:timestamp,batch:[{event:event.event,distinct_id:String(event.distinct_id),timestamp,properties}]},fetcher)
    return await postJson(`${origin}/i/v0/e/`,{api_key:env.POSTHOG_PROJECT_TOKEN,timestamp,distinct_id:event.distinct_id,event:event.event,properties},fetcher)
  } catch {return false}
}

export const captureAiGeneration=(env,data,fetcher=fetch)=>capturePosthogEvent(env,aiGenerationEvent(env,data),fetcher)
