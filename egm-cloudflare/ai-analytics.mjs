// PostHog LLM analytics: one $ai_generation event per Ask request. The dashboard snapshot sent as
// system context is left out; only the conversation turns and the answer are recorded.
const hosts=['us.i.posthog.com','eu.i.posthog.com']
const seconds=ms=>Number.isFinite(ms)?Math.round(ms)/1000:undefined

export function aiGenerationEvent(env,data) {
  const properties={
    $geoip_disable:true,
    $ai_trace_id:data.traceId,
    $ai_span_name:'ask',
    $ai_provider:'gemini',
    $ai_model:data.model,
    $ai_input:data.input,
    $ai_output_choices:data.error?undefined:[{role:'assistant',content:data.output}],
    $ai_input_tokens:data.usage?.promptTokenCount,
    $ai_output_tokens:data.usage?.candidatesTokenCount,
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

export async function capturePosthogEvent(env,event,fetcher=fetch) {
  try {
    if(!env.POSTHOG_PROJECT_TOKEN||!env.POSTHOG_HOST)return false
    const host=new URL(env.POSTHOG_HOST)
    if(host.protocol!=='https:'||!hosts.includes(host.hostname))return false
    const response=await fetcher(new URL('/i/v0/e/',host).href,{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify({api_key:env.POSTHOG_PROJECT_TOKEN,...event}),signal:AbortSignal.timeout(5000)})
    return response.ok
  } catch {return false}
}

export const captureAiGeneration=(env,data,fetcher=fetch)=>capturePosthogEvent(env,aiGenerationEvent(env,data),fetcher)
