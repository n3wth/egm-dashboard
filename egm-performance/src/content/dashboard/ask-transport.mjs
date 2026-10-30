import {EMPTY_ANSWER,consumeAskStream,emptyAnswer} from './ask-stream.mjs'

export const askErrorMessage=status=>status===401?'Your session expired. Sign in again to ask a question.':status===403?'Your account does not have access to Ask.':status===429?'You have reached the hourly question limit. Try again later.':status===400||status===413?'Use a question between 1 and 1,200 characters.':status===504?'The answer took too long. Try a shorter question.':'Ask is temporarily unavailable. Try again shortly.'

const TIMEOUT='The answer took too long. Try again.'
const OFFLINE='You are offline. Reconnect and try again.'
const NETWORK='Could not reach Ask. Check your connection and try again.'
const DROPPED='The connection dropped before the answer finished. Try again.'
const INCOMPLETE='Ask returned an incomplete answer.'
// Retrying cannot fix these: sign in, access, the hourly limit, and the question itself.
const NO_RETRY=new Set([401,403,429,400,413].map(askErrorMessage))
export const askRetryable=message=>!NO_RETRY.has(message)
export const askNeedsSignIn=message=>message===askErrorMessage(401)
// fetch and stream reads reject with TypeError when the network fails; response.json rejects with SyntaxError.
export const askFailureMessage=(failure,{timedOut=false,streaming=false}={})=>timedOut?TIMEOUT:failure instanceof TypeError?(streaming?DROPPED:NETWORK):failure instanceof SyntaxError?INCOMPLETE:failure?.message||NETWORK

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
      if(globalThis.navigator?.onLine===false)throw new Error(OFFLINE)
      response=await this.fetch('/api/ask',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','accept':'application/x-ndjson'},body:JSON.stringify({question,history:askHistory(messages),stream:true,format:'markdown'}),signal:controller.signal})
      if(!response.ok)throw new Error(askErrorMessage(response.status))
    } catch(failure) {
      cleanup()
      if(abortSignal?.aborted)this.onOutcome('stopped')
      else this.onOutcome('failed')
      throw timedOut||failure instanceof TypeError?new Error(askFailureMessage(failure,{timedOut})):failure
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
              // Same data part id replaces the earlier one, so a step moves from active to done in place.
              else if(event.type==='step'){const {type,...step}=event;output.enqueue({type:'data-step',id:step.id,data:step})}
              else if(event.type==='result') {
                if(!open){textStart();output.enqueue({type:'text-delta',id:'answer',delta:event.answer})}
                finish(event)
              }
            },{signal:controller.signal})
          } else {
            const result=await response.json()
            if(typeof result.answer!=='string')throw new Error(INCOMPLETE)
            if(emptyAnswer(result.answer))throw new Error(EMPTY_ANSWER)
            textStart()
            output.enqueue({type:'text-delta',id:'answer',delta:result.answer})
            finish(result)
          }
        } catch(failure) {
          if(abortSignal?.aborted){onOutcome('stopped')}
          else {
            onOutcome('failed')
            output.enqueue({type:'error',errorText:askFailureMessage(failure,{timedOut,streaming:true})})
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

export const citeId=(messageId,id)=>`ask-cite-${String(messageId).replace(/[^\w-]/g,'')}-${id}`
// Turns [n] markers that match a source into links the response renders as citation chips.
export function linkCitations(text,sources,messageId) {
  const ids=new Set((sources??[]).map((source,index)=>String(source.id??index+1)))
  return ids.size?text.replace(/\[(\d+)\](?!\()/g,(match,id)=>ids.has(id)?`[${id}](#${citeId(messageId,id)})`:match):text
}

// Splits a final answer at Markdown headings and places each card after the section that first cites its source; uncited cards follow the last section.
// shortcut: a heading-like line inside a fenced code block also splits; answers are told not to emit code, revisit if they do.
export function answerSections(text,cards) {
  const sections=text.split(/\n(?=#{1,4} )/).map(part=>({text:part,cards:[]}))
  ;(cards??[]).forEach((card,index)=>{
    const at=card.sourceId?sections.findIndex(section=>section.text.includes(`[${card.sourceId}]`)):-1
    ;(at>=0?sections[at]:sections.at(-1)).cards.push({card,index})
  })
  return sections
}
