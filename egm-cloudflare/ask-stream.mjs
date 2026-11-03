// Character budget for one answer, shared with the non-streaming path in ask.mjs.
export const ASK_ANSWER_CHARS=12000
// Workers AI stream:true returns SSE response tokens, not a completed response.
export function streamAsk(run,finalize,signal,timeoutMs=30000,hooks={}) {
  const encoder=new TextEncoder()
  let reader,closed=false,timer,output,rejectWait
  const abort=()=>{closed=true;rejectWait?.(Error('cancelled'));reader?.cancel().catch(()=>{});try{output?.close()}catch{}}
  const body=new ReadableStream({
    async start(controller) {
      output=controller
      const send=value=>{if(!closed)controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'))}
      const step=(id,label,status,detail)=>send({type:'step',id,label,status,...(detail?{detail}:{})})
      const timeout=new Promise((_,reject)=>{rejectWait=reject})
      timer=setTimeout(()=>rejectWait(Error('timeout')),timeoutMs)
      signal?.addEventListener('abort',abort,{once:true})
      try {
        if(signal?.aborted){abort();return}
        const pending=run(step)
        // A stream that arrives after cancel/timeout must still be released.
        pending.then(late=>{if(closed)late?.cancel?.().catch(()=>{})},()=>{})
        const stream=await Promise.race([pending,timeout])
        if(!stream?.getReader)throw Error('invalid_stream')
        reader=stream.getReader()
        if(closed){await reader.cancel();return}
        const decoder=new TextDecoder()
        let buffer='',answer='',data=[],doneEvent=false
        const event=()=>{
          if(!data.length)return
          const value=data.join('\n');data=[]
          if(value==='[DONE]'){doneEvent=true;return}
          const payload=JSON.parse(value)
          if(payload.error)throw Error('provider_failed')
          if(typeof payload.response==='string'&&payload.response) {
            if(answer.length+payload.response.length>ASK_ANSWER_CHARS)throw Error('output_too_large')
            answer+=payload.response
            send({type:'delta',text:payload.response})
          }
        }
        while(!closed&&!doneEvent) {
          const chunk=await Promise.race([reader.read(),timeout])
          buffer+=decoder.decode(chunk.value??new Uint8Array(),{stream:!chunk.done})
          if(buffer.length>16384)throw Error('event_too_large')
          let index
          while((index=buffer.indexOf('\n'))>=0) {
            const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1)
            if(!line)event()
            else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''))
            if(doneEvent)break
          }
          if(chunk.done){if(buffer.startsWith('data:'))data.push(buffer.slice(5).trim());event();break}
        }
        if(!closed) {
          if(!doneEvent||!answer.trim())throw Error('incomplete_stream')
          send({type:'result',...finalize(answer.trim())})
        }
      }catch(error){hooks.onError?.(error);send({type:'error',error:error?.message==='timeout'?'ask_timeout':'ask_unavailable'})}
      finally {
        hooks.onFinally?.()
        clearTimeout(timer)
        signal?.removeEventListener('abort',abort)
        await reader?.cancel().catch(()=>{})
        if(!closed){closed=true;controller.close()}
      }
    },
    cancel(){abort();clearTimeout(timer)}
  })
  return new Response(body,{headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}})
}
