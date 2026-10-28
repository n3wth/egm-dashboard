export async function consumeAskStream(stream,onEvent,{signal}={}) {
  if(!stream)throw new Error('Ask returned no response stream.')
  const reader=stream.getReader()
  const decoder=new TextDecoder()
  let pending=''
  let result=null
  const abort=()=>{reader.cancel().catch(()=>{})}
  signal?.addEventListener('abort',abort,{once:true})
  const parse=line=>{
    if(!line.trim()||result)return
    const event=JSON.parse(line)
    if(event.type==='error')throw new Error(event.error==='ask_timeout'?'The answer took too long. Try again.':'Ask is temporarily unavailable. Try again shortly.')
    if(event.type==='delta'&&typeof event.text==='string')onEvent(event)
    if(event.type==='result') {
      if(typeof event.answer!=='string')throw new Error('Ask returned an incomplete answer.')
      result=event
      onEvent(event)
    }
  }
  try {
    while(true) {
      if(signal?.aborted)throw new DOMException('Stopped','AbortError')
      const {done,value}=await reader.read()
      if(signal?.aborted)throw new DOMException('Stopped','AbortError')
      pending+=done?decoder.decode():decoder.decode(value,{stream:true})
      if(pending.length>1000000)throw new Error('Ask response is too large.')
      let newline
      while((newline=pending.indexOf('\n'))>=0){parse(pending.slice(0,newline));pending=pending.slice(newline+1)}
      if(done){parse(pending);break}
    }
    if(!result)throw new Error('The response ended before completion. Try again.')
    return result
  } finally {
    signal?.removeEventListener('abort',abort)
    await reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
}
