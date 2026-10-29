export const GEMINI_MODEL='gemini-flash-latest'
const endpoint=(model,stream)=>`https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream?'streamGenerateContent?alt=sse':'generateContent'}`

function body(messages,max_tokens,temperature,thinking) {
  const system=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n')
  return JSON.stringify({
    ...(system?{systemInstruction:{parts:[{text:system}]}}:{}),
    contents:messages.filter(message=>message.role!=='system').map(message=>({role:message.role==='assistant'?'model':'user',parts:[{text:String(message.content)}]})),
    generationConfig:{maxOutputTokens:max_tokens,temperature,...(thinking?{thinkingConfig:{thinkingBudget:0}}:{})},
  })
}

const textOf=payload=>(payload?.candidates?.[0]?.content?.parts??[]).filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('')

// Re-emits Gemini SSE as the `data: {"response":"..."}` events streamAsk already parses.
function toResponseStream(source) {
  const encoder=new TextEncoder(),decoder=new TextDecoder()
  let buffer='',reader
  return new ReadableStream({
    async pull(controller) {
      reader??=source.getReader()
      // pull is not called again until something is enqueued, so keep reading until a chunk yields output.
      for(;;) {
        const {done,value}=await reader.read()
        if(done){controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();return}
        buffer+=decoder.decode(value,{stream:true})
        let emitted=false,index
        while((index=buffer.indexOf('\n'))>=0) {
          const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1)
          if(!line.startsWith('data:'))continue
          let payload
          try {payload=JSON.parse(line.slice(5))}catch{controller.enqueue(encoder.encode('data: {"error":"bad_event"}\n\n'));emitted=true;continue}
          if(payload.error){controller.enqueue(encoder.encode('data: {"error":"provider_failed"}\n\n'));emitted=true;continue}
          const text=textOf(payload)
          if(text){controller.enqueue(encoder.encode('data: '+JSON.stringify({response:text})+'\n\n'));emitted=true}
        }
        if(emitted)return
      }
    },
    cancel(){return reader?.cancel()},
  })
}

// Same call shape as Workers AI `run(model,{messages,max_tokens,temperature,stream})`.
export function geminiRunner(env,fetcher=fetch) {
  if(!env.GEMINI_API_KEY)return null
  return {
    async run(model,{messages,max_tokens,temperature,stream}) {
      const call=thinking=>fetcher(endpoint(model,stream),{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:body(messages,max_tokens,temperature,thinking)})
      let response=await call(true)
      // The latest alias may move to a model that rejects a thinking budget; retry once without it.
      if(response.status===400)response=await call(false)
      if(!response.ok||(stream&&!response.body)){await response.body?.cancel().catch(()=>{});throw Error('provider_failed')}
      if(stream)return toResponseStream(response.body)
      return {response:textOf(await response.json())}
    },
  }
}
