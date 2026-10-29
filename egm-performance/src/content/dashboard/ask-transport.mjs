import {consumeAskStream} from './ask-stream.mjs'

export const askErrorMessage=status=>status===401?'Your session expired. Sign in again to ask a question.':status===403?'Your account does not have access to Ask.':status===429?'You have reached the hourly question limit. Try again later.':status===400||status===413?'Use a question between 1 and 1,200 characters.':status===504?'The answer took too long. Try a shorter question.':'Ask is temporarily unavailable. Try again shortly.'

export const messageText=message=>(message?.parts??[]).filter(part=>part.type==='text').map(part=>part.text).join('')
export const messageResult=message=>(message?.parts??[]).find(part=>part.type==='data-result')?.data??null
// The Worker's final answer replaces streamed deltas, matching the pre-AI SDK behavior.
export const answerText=message=>messageResult(message)?.answer??messageText(message)

// Completed question/answer pairs before the final user message, in the Worker's history shape.
export function askHistory(messages) {
  const pairs=[]
  for(let i=0;i<messages.length-2;i++) {
    const [user,assistant]=[messages[i],messages[i+1]]
    if(user.role==='user'&&assistant.role==='assistant'&&messageResult(assistant))pairs.push({question:messageText(user),answer:answerText(assistant).slice(0,2000)})
  }
  return pairs.slice(-4)
}

const normalize=result=>({...result,sources:Array.isArray(result.sources)?result.sources:[],cards:Array.isArray(result.cards)?result.cards.slice(0,3):[]})

// Adapts the Worker's NDJSON delta/result stream to AI SDK UI message chunks.
export class AskTransport {
  constructor({fetch:fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=60000,onOutcome=()=>{}}={}) {
    this.fetch=fetcher
    this.timeoutMs=timeoutMs
    this.onOutcome=onOutcome
  }
  async sendMessages({messages,abortSignal}) {
    const question=messageText(messages.at(-1)).trim()
    const controller=new AbortController()
    let timedOut=false
    const abort=()=>controller.abort()
    abortSignal?.addEventListener('abort',abort,{once:true})
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},this.timeoutMs)
    const cleanup=()=>{clearTimeout(timer);abortSignal?.removeEventListener('abort',abort)}
    this.onOutcome('submitted')
    let response
    try {
      response=await this.fetch('/api/ask',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','accept':'application/x-ndjson'},body:JSON.stringify({question,history:askHistory(messages),stream:true,format:'markdown'}),signal:controller.signal})
      if(!response.ok)throw new Error(askErrorMessage(response.status))
    } catch(failure) {
      cleanup()
      if(abortSignal?.aborted)this.onOutcome('stopped')
      else this.onOutcome('failed')
      throw timedOut?new Error('The answer took too long. Try again.'):failure
    }
    const onOutcome=this.onOutcome
    return new ReadableStream({
      async start(output) {
        let open=false
        const textStart=()=>{if(!open){open=true;output.enqueue({type:'text-start',id:'answer'})}}
        const finish=result=>{
          textStart()
          output.enqueue({type:'text-end',id:'answer'})
          output.enqueue({type:'data-result',id:'result',data:normalize(result)})
          output.enqueue({type:'finish'})
          onOutcome('completed')
        }
        output.enqueue({type:'start'})
        try {
          if(response.headers.get('content-type')?.includes('application/x-ndjson')) {
            await consumeAskStream(response.body,event=>{
              if(event.type==='delta'){textStart();output.enqueue({type:'text-delta',id:'answer',delta:event.text})}
              else if(event.type==='result') {
                if(!open){textStart();output.enqueue({type:'text-delta',id:'answer',delta:event.answer})}
                finish(event)
              }
            },{signal:controller.signal})
          } else {
            const result=await response.json()
            if(typeof result.answer!=='string')throw new Error('Ask returned an incomplete answer.')
            textStart()
            output.enqueue({type:'text-delta',id:'answer',delta:result.answer})
            finish(result)
          }
        } catch(failure) {
          if(abortSignal?.aborted){onOutcome('stopped')}
          else {
            onOutcome('failed')
            output.enqueue({type:'error',errorText:timedOut?'The answer took too long. Try again.':failure.message||'Could not reach Ask. Try again.'})
          }
        } finally {
          cleanup()
          try{output.close()}catch{}
        }
      },
    })
  }
  async reconnectToStream() { return null }
}
