import React,{useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {DataComponent,DataTable,EvidenceChart,Icon,useDataApp} from '../../data-app-public.jsx'
import './ask-panel.css'
import {consumeAskStream} from './ask-stream.mjs'

const errorMessage=status=>status===401?'Your session expired. Sign in again to ask a question.':status===403?'Your account does not have access to Ask.':status===429?'You have reached the hourly question limit. Try again later.':status===400||status===413?'Use a question between 1 and 1,200 characters.':status===504?'The answer took too long. Try a shorter question.':'Ask is temporarily unavailable. Try again shortly.'
const sourceHref=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}}
const format=value=>typeof value==='number'?value.toLocaleString('en-US'):String(value??'Unavailable')

function AnswerCard({card,index,turnId}) {
  const {queries}=useDataApp()
  const rows=Array.isArray(card.rows)?card.rows:[]
  const source=queries[card.queryId]
  const props={id:`ask-result-${turnId}-${index}-${card.queryId}`,title:card.title,queryId:source?card.queryId:undefined,sourceRows:source?.rows??rows,displayRows:rows,variant:'card',showActions:Boolean(source)}
  const foot=<p className="egm-note">{card.sourceId&&`[${card.sourceId}]`}{card.observedAt&&<time dateTime={card.observedAt} title={card.observedAt}> · {new Date(card.observedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time>}</p>
  if(card.type==='chart'&&rows.length&&Array.isArray(card.series)&&card.series.length)return <EvidenceChart {...props} rows={rows} height={210} spec={{type:'line',x:card.xKey??'date',y:card.series[0],fields:card.series,colors:Object.fromEntries(card.series.map((field,index)=>[field,index%2?'var(--chart-4)':'var(--chart-1)'])),legend:{labels:card.seriesLabels??{}},showXAxisLabel:false,showYAxisLabel:false}}>{foot}</EvidenceChart>
  if(card.type==='table')return <DataComponent {...props} kind="table"><DataTable rows={rows} searchable={false} pageSize={5} columns={(card.columns??[]).map(field=>({field,label:card.columnLabels?.[field]??field}))} label={card.title}/>{card.rowsTruncated&&<p className="egm-note">Showing {rows.length} of {card.rowCount} rows.</p>}{foot}</DataComponent>
  if(card.type==='metric')return <DataComponent {...props} kind="custom"><dl className="egm-ask-metrics">{(card.metrics??[]).map((metric,i)=><div key={i}><dt>{metric.label}</dt><dd>{format(metric.value)}</dd></div>)}</dl>{foot}</DataComponent>
  return null
}

export function AskPanel({open,onClose,initialQuestion=''}) {
  const [question,setQuestion]=useState(initialQuestion)
  const [turns,setTurns]=useState([])
  const [loading,setLoading]=useState(false)
  const [hosts,setHosts]=useState(null)
  const request=useRef(null)
  const input=useRef(null)
  const bottom=useRef(null)
  const followBottom=useRef(true)
  const sequence=useRef(0)
  const latest=turns.at(-1)
  const nearBottom=()=>window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-160
  function updateTurn(id,change) {
    followBottom.current=nearBottom()
    setTurns(previous=>previous.map(turn=>turn.id===id?{...turn,...(typeof change==='function'?change(turn):change)}:turn))
  }
  function stop() {
    const active=request.current
    if(!active)return
    active.stopped=true
    active.controller.abort()
    updateTurn(active.id,{status:'stopped'})
    setLoading(false)
  }
  const close=()=>{stop();onClose()}
  useEffect(()=>{
    if(!open)return
    const trigger=document.querySelector('.dashboard-ask-button')
    const main=document.querySelector('main.page')
    if(!trigger?.parentElement||!main)return
    const headerHost=document.createElement('span')
    headerHost.className='egm-ask-inline-host'
    const bodyHost=document.createElement('div')
    bodyHost.className='egm-ask-body-host'
    trigger.parentElement.append(headerHost)
    const previousDisplay=trigger.style.display
    trigger.style.display='none'
    main.prepend(bodyHost)
    setHosts({headerHost,bodyHost,main})
    return ()=>{headerHost.remove();bodyHost.remove();main.classList.remove('egm-ask-page');trigger.style.display=previousDisplay;setHosts(null);trigger.focus()}
  },[open])
  useEffect(()=>{if(open&&initialQuestion)setQuestion(initialQuestion)},[open,initialQuestion])
  useEffect(()=>()=>request.current?.controller.abort(),[])
  useEffect(()=>{if(hosts)input.current?.focus()},[hosts])
  useEffect(()=>{hosts?.main.classList.toggle('egm-ask-page',turns.length>0)},[hosts,turns.length])
  useLayoutEffect(()=>{if(open&&followBottom.current&&turns.length)bottom.current?.scrollIntoView({block:'end',behavior:'instant'})},[open,turns])
  useEffect(()=>{
    if(!open||!hosts)return
    const outside=event=>{if(event.target.closest?.('[role="menu"],[role="dialog"],.source-sidebar'))return;if(!hosts.headerHost.contains(event.target)&&!hosts.bodyHost.contains(event.target)){stop();onClose()}}
    const escape=event=>{if(event.key==='Escape'){event.preventDefault();stop();onClose()}}
    const scroll=()=>{followBottom.current=nearBottom()}
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    window.addEventListener('scroll',scroll,{passive:true})
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll)}
  },[open,hosts,onClose])
  async function send(submitted,retryId) {
    submitted=submitted.trim()
    if(!submitted||submitted.length>1200||loading)return
    request.current?.controller.abort()
    const id=retryId??++sequence.current
    const controller=new AbortController()
    const active={controller,id,stopped:false,timedOut:false}
    request.current=active
    followBottom.current=true
    const pending={id,question:submitted,text:'',status:'pending',result:null,error:null}
    setTurns(previous=>retryId?previous.map(turn=>turn.id===retryId?pending:turn):[...previous,pending])
    setQuestion('');setLoading(true)
    const timeout=setTimeout(()=>{active.timedOut=true;controller.abort()},60000)
    const complete=result=>updateTurn(id,{text:result.answer,status:'complete',result:{...result,sources:Array.isArray(result.sources)?result.sources:[],cards:Array.isArray(result.cards)?result.cards.slice(0,3):[]}})
    try {
      const history=turns.filter(turn=>turn.status==='complete'&&turn.id!==id).slice(-4).map(turn=>({question:turn.question,answer:turn.text.slice(0,2000)}))
      const response=await fetch('/api/ask',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','accept':'application/x-ndjson'},body:JSON.stringify({question:submitted,history,stream:true}),signal:controller.signal})
      if(!response.ok)throw new Error(errorMessage(response.status))
      if(response.headers.get('content-type')?.includes('application/x-ndjson')) {
        await consumeAskStream(response.body,event=>{
          if(controller.signal.aborted)return
          if(event.type==='delta')updateTurn(id,turn=>({text:turn.text+event.text,status:'streaming'}))
          else if(event.type==='result')complete(event)
        },{signal:controller.signal})
      } else {
        const result=await response.json()
        if(typeof result.answer!=='string')throw new Error('Ask returned an incomplete answer.')
        if(!controller.signal.aborted)complete(result)
      }
    } catch(failure) {
      if(active.stopped)updateTurn(id,{status:'stopped'})
      else updateTurn(id,{status:'error',error:active.timedOut?'The answer took too long. Try again.':failure.message||'Could not reach Ask. Try again.'})
    } finally {
      clearTimeout(timeout)
      if(request.current===active){request.current=null;setLoading(false)}
    }
  }
  if(!open||!hosts)return null
  const submit=event=>{event.preventDefault();send(question)}
  const composer=<form className={turns.length?'egm-ask-composer':'egm-ask-inline'} onSubmit={submit}>
    <Icon name="chatBubble" size={16}/><input ref={input} aria-label={turns.length?'Ask a follow-up':'Ask EGM'} value={question} onChange={event=>setQuestion(event.target.value)} maxLength={1200} placeholder={turns.length?'Ask a follow-up…':'Ask about EGM…'} required/>
    {loading?<button type="button" onClick={stop} aria-label="Stop generating" title="Stop generating"><Icon name="stop" size={18}/></button>:<button type="submit" aria-label="Send question" disabled={!question.trim()}><Icon name="sendUp" size={18}/></button>}
    {!turns.length&&<button type="button" aria-label="Close Ask" onClick={close}><Icon name="cross" size={16}/></button>}
  </form>
  return <>
    {createPortal(turns.length?<button className="egm-ask-active-toggle" type="button" onClick={close} aria-label="Close Ask" title="Close Ask"><Icon name="chatBubble" size={18}/></button>:composer,hosts.headerHost)}
    {turns.length>0&&createPortal(<section className="egm-ask-conversation" aria-label="Ask EGM conversation">
      <div className="egm-ask-messages">{turns.map(turn=><article className="egm-ask-turn" key={turn.id}>
        <div className="egm-ask-user"><span className="egm-chat-speaker">You</span><p>{turn.question}</p></div>
        <div className="egm-ask-assistant" aria-busy={['pending','streaming'].includes(turn.status)}><span className="egm-chat-speaker">EGM</span>
          {turn.text&&<p className="egm-ask-message-text">{turn.text}</p>}
          {turn.status==='pending'&&<div role="status"><span className="egm-note">Reading dashboard data…</span><div className="egm-ask-skeletons" aria-hidden="true">{[0,1,2].map(i=><div key={i}><span/><span/><span/></div>)}</div></div>}
          {turn.status==='streaming'&&<span className="egm-note" role="status">Generating…</span>}
          {turn.status==='stopped'&&<p className="egm-note" role="status">Stopped. {turn.text?'Partial response.':'No response generated.'}</p>}
          {turn.status==='error'&&<div className="egm-ask-error" role="alert">{turn.error} <button type="button" disabled={loading} onClick={()=>send(turn.question,turn.id)}>Retry</button></div>}
          {turn.result&&<><div className="egm-ask-options">{turn.result.toolStatus?.status==='live'?'GitHub checked live':turn.result.toolStatus?.status==='unavailable'?'Live check unavailable. Saved data shown.':'Saved dashboard data'}</div>{turn.result.cards.length>0&&<div className="egm-ask-cards">{turn.result.cards.map((card,index)=><AnswerCard key={`${turn.id}-${card.queryId}-${index}`} turnId={turn.id} card={card} index={index}/>)}</div>}{typeof turn.result.coverageNote==='string'&&turn.result.coverageNote&&<p className="egm-note">{turn.result.coverageNote}</p>}{turn.result.sources.length>0&&<details className="egm-ask-sources"><summary>Sources ({turn.result.sources.length})</summary><ul>{turn.result.sources.map((source,index)=>{const href=sourceHref(source.url);const label=`[${source.id??index+1}] ${source.label??source.title??source.queryId??'Saved data'}`;return <li key={`${source.id??index}-${source.queryId??''}`}>{href?<a href={href} target="_blank" rel="noreferrer">{label}</a>:<span>{label}</span>}{source.observedAt&&<time dateTime={source.observedAt} title={source.observedAt}> · {new Date(source.observedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'})}</time>}</li>})}</ul></details>}</>}
        </div>
      </article>)}</div>
      {!loading&&latest?.status==='complete'&&Array.isArray(latest.result?.suggestedFollowUps)&&<div className="egm-ask-followups">{latest.result.suggestedFollowUps.filter(value=>typeof value==='string'&&value.length<=1200).slice(0,3).map(value=><button type="button" key={value} onClick={()=>send(value)}>{value}<Icon name="arrowUpRight" size={14}/></button>)}</div>}
      <div className="egm-ask-composer-wrap">{composer}</div><div ref={bottom}/>
    </section>,hosts.bodyHost)}
  </>
}
