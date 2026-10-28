import React, {useEffect, useRef, useState} from 'react'
import {Icon, Section} from '../../data-app-public.jsx'
import {AnswerCard} from './AskPanel.jsx'
import {consumeAskStream} from './ask-stream.mjs'
import './growth-advice.css'

const prompts = [
  {label:'Find growth opportunities', detail:'Prioritize experiments', icon:'lightbulb', question:'Using the repository traffic, referrers, website and mentions, propose the three most useful growth experiments. For each, give the evidence, a concrete next step, a success measure and what remains unknown. Do not infer causality.'},
  {label:'Improve first use', detail:'Find onboarding friction', icon:'sites', question:'Using repository traffic and available research evidence, propose a small experiment to improve the first EGM workflow. Explain the evidence, the steps, the success measure and what is not measured.'},
  {label:'Explore distribution', detail:'Discover channels', icon:'arrowUpRight', question:'Using referrers, videos and mentions, propose a practical distribution experiment for EGM. Distinguish observed reach from hypotheses and specify how to evaluate it.'}
]
const sourceHref=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}}

export function GrowthAdvice() {
  const [result,setResult] = useState(null)
  const [answer,setAnswer] = useState('')
  const [selected,setSelected] = useState('')
  const [question,setQuestion] = useState('')
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const request=useRef(null)
  const sequence=useRef(0)
  useEffect(()=>()=>request.current?.abort(),[])
  async function ask(label, text) {
    if(loading||!text.trim())return
    const controller=new AbortController()
    request.current=controller
    const id=++sequence.current
    setSelected(label); setLoading(true); setError(''); setResult(null); setAnswer('')
    const timeout=setTimeout(()=>controller.abort(),60000)
    try {
      const response = await fetch('/api/ask', {method:'POST', credentials:'same-origin', headers:{'content-type':'application/json','accept':'application/x-ndjson'}, body:JSON.stringify({question:text,stream:true}),signal:controller.signal})
      if (!response.ok) throw new Error(response.status===429?'Question limit reached. Try again later.':response.status===401?'Your session expired. Sign in again.':'Advice is unavailable right now. Try again later.')
      const complete=data=>{if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('The response was incomplete. Try again.');setAnswer(data.answer);setResult({...data,id})}
      if(response.headers.get('content-type')?.includes('application/x-ndjson')) await consumeAskStream(response.body,event=>{if(event.type==='delta')setAnswer(previous=>previous+event.text);else if(event.type==='result')complete(event)},{signal:controller.signal})
      else complete(await response.json())
    } catch (failure) { setError(controller.signal.aborted?'Request stopped or timed out.':failure.message || 'Advice is unavailable right now.') }
    finally { clearTimeout(timeout); if(request.current===controller)request.current=null; setLoading(false) }
  }
  return <Section id="growth-advice-heading" title="Growth advice" spacing="none">
    <div className="egm-growth-advice">
      <div className="egm-growth-intro"><div><p className="egm-growth-eyebrow">YOUR GROWTH WORKSPACE</p><h2>Turn signals into your next move.</h2><p>Explore opportunities, test ideas and see the evidence behind each suggestion.</p></div><div className="egm-growth-mark" aria-hidden="true"><span/><span/><span/><span/><span/></div></div>
      <div className="egm-growth-prompts">{prompts.map(prompt=><button key={prompt.label} type="button" disabled={loading} onClick={()=>ask(prompt.label,prompt.question)}><span className="egm-growth-prompt-icon"><Icon name={prompt.icon} size={19}/></span><span><strong>{prompt.label}</strong><small>{prompt.detail}</small></span><Icon name="arrowUpRight" size={16}/></button>)}</div>
      <form className="egm-growth-compose" onSubmit={event=>{event.preventDefault();ask('Your question',question)}}>
        <label htmlFor="growth-question">Ask a growth question</label><div><input id="growth-question" value={question} onChange={event=>setQuestion(event.target.value)} maxLength={1200} placeholder="What should we try next?" /><button type="submit" disabled={loading||!question.trim()} aria-label="Generate advice"><Icon name="sendUp" size={18}/></button></div>
      </form>
      <p className="egm-note">Suggestions are hypotheses for review. Repository views and clones do not measure successful first use or retention.</p>
      {(loading||answer||error)&&<article className="egm-growth-result" aria-busy={loading}><div className="egm-growth-result-heading"><div><span className="egm-growth-status-dot"/><strong>{selected}</strong></div>{loading&&<button type="button" onClick={()=>request.current?.abort()}>Stop</button>}</div>
        {loading&&!answer&&<div className="egm-growth-thinking" role="status"><span className="egm-growth-pulse"/><span>Reading the evidence and shaping an experiment…</span></div>}
        {answer&&<p className="egm-growth-answer">{answer}</p>}
        {error&&<p role="alert">{error}</p>}
        {result&&<><div className="egm-growth-meta">{result.toolStatus?.status==='live'?'GitHub checked live':result.toolStatus?.status==='unavailable'?'Live check unavailable · saved data':'Saved dashboard data'}{result.snapshotAt&&<> · Snapshot <time dateTime={result.snapshotAt}>{new Date(result.snapshotAt).toLocaleString()}</time></>}</div>
          {Array.isArray(result.cards)&&result.cards.length>0&&<div className="egm-growth-cards">{result.cards.slice(0,3).map((card,index)=><AnswerCard key={index} card={card} index={index} turnId={'growth-'+result.id}/>)}</div>}
          {result.coverageNote&&<p className="egm-note">{result.coverageNote}</p>}
          {Array.isArray(result.sources)&&result.sources.length>0&&<details className="egm-growth-sources"><summary>Sources ({result.sources.length})</summary><ul>{result.sources.map((source,index)=>{const href=sourceHref(source.url);const label=`[${source.id??index+1}] ${source.label??source.title??source.queryId??'Dashboard data'}`;return <li key={source.id??index}>{href?<a href={href} target="_blank" rel="noreferrer">{label}</a>:label}{source.observedAt&&<> · <time dateTime={source.observedAt}>{new Date(source.observedAt).toLocaleDateString()}</time></>}</li>})}</ul></details>}
        </>}
      </article>}
    </div>
  </Section>
}
