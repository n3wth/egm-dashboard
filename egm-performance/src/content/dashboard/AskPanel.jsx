import React,{useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {DataComponent,DataTable,EvidenceChart,Icon,useDataApp} from '../../data-app-public.jsx'
import './ask-panel.css'

const errorMessage=status=>status===401?'Your session expired. Sign in again to ask a question.':status===403?'Your account does not have access to Ask.':status===429?'You have reached the hourly question limit. Try again later.':status===400||status===413?'Use a question between 1 and 1,200 characters.':status===504?'The answer took too long. Try a shorter question.':'Ask is temporarily unavailable. Try again shortly.'
const sourceHref=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}}
const format=value=>typeof value==='number'?value.toLocaleString('en-US'):String(value??'Unavailable')

function AnswerCard({card,index}) {
  const {queries}=useDataApp()
  const rows=Array.isArray(card.rows)?card.rows:[]
  const source=queries[card.queryId]
  const props={id:`ask-result-${index}-${card.queryId}`,title:card.title,queryId:source?card.queryId:undefined,sourceRows:source?.rows??rows,displayRows:rows,variant:'card',showActions:Boolean(source)}
  const foot=<p className="egm-note">{card.sourceId&&`[${card.sourceId}]`}{card.observedAt&&<time dateTime={card.observedAt} title={card.observedAt}> · {new Date(card.observedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time>}</p>
  if(card.type==='chart'&&rows.length&&Array.isArray(card.series)&&card.series.length)return <EvidenceChart {...props} rows={rows} height={210} spec={{type:'line',x:card.xKey??'date',y:card.series[0],fields:card.series,showXAxisLabel:false,showYAxisLabel:false}}>{foot}</EvidenceChart>
  if(card.type==='table')return <DataComponent {...props} kind="table"><DataTable rows={rows} searchable={false} pageSize={5} columns={(card.columns??[]).map(field=>({field,label:field}))} label={card.title}/>{card.rowsTruncated&&<p className="egm-note">Showing {rows.length} of {card.rowCount} rows.</p>}{foot}</DataComponent>
  if(card.type==='metric')return <DataComponent {...props} kind="custom"><dl className="egm-ask-metrics">{(card.metrics??[]).map((metric,i)=><div key={i}><dt>{metric.label}</dt><dd>{format(metric.value)}</dd></div>)}</dl>{foot}</DataComponent>
  return null
}

export function AskPanel({open,onClose,initialQuestion=''}) {
  const [question,setQuestion]=useState(initialQuestion)
  const [loading,setLoading]=useState(false)
  const [answer,setAnswer]=useState(null)
  const [error,setError]=useState('')
  const [hosts,setHosts]=useState(null)
  const request=useRef(null)
  const input=useRef(null)
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
    setHosts({headerHost,bodyHost})
    return ()=>{headerHost.remove();bodyHost.remove();trigger.style.display=previousDisplay;setHosts(null);trigger.focus()}
  },[open])
  useEffect(()=>{
    request.current?.abort()
    if(open){setQuestion(initialQuestion);setAnswer(null);setError('')}
    setLoading(false)
    return ()=>request.current?.abort()
  },[open,initialQuestion])
  useEffect(()=>{if(hosts)input.current?.focus()},[hosts])
  useEffect(()=>{
    if(!open||!hosts)return
    const close=()=>{request.current?.abort();onClose()}
    const outside=event=>{if(!hosts.headerHost.contains(event.target)&&!hosts.bodyHost.contains(event.target))close()}
    const escape=event=>{if(event.key==='Escape'){event.preventDefault();close()}}
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[open,hosts,onClose])
  async function submit(event) {
    event.preventDefault()
    if(!question.trim()||loading)return
    request.current?.abort()
    const controller=new AbortController()
    request.current=controller
    setLoading(true);setError('');setAnswer(null)
    let timedOut=false
    const timeout=setTimeout(()=>{timedOut=true;controller.abort()},45000)
    try {
      const response=await fetch('/api/ask',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({question:question.trim()}),signal:controller.signal})
      if(!response.ok)throw new Error(errorMessage(response.status))
      const result=await response.json()
      if(typeof result.answer!=='string')throw new Error('Ask returned an incomplete answer. Try again.')
      if(!controller.signal.aborted)setAnswer({...result,sources:Array.isArray(result.sources)?result.sources:[],cards:Array.isArray(result.cards)?result.cards.slice(0,3):[]})
    }catch(failure){if(!controller.signal.aborted)setError(failure.message||'Could not reach Ask. Try again.');else if(timedOut)setError('The answer took too long. Try again.')}
    finally {clearTimeout(timeout);if(request.current===controller)setLoading(false)}
  }
  if(!open||!hosts)return null
  const close=()=>{request.current?.abort();onClose()}
  return <>
    {createPortal(<form className="egm-ask-inline" onSubmit={submit} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close()}}}>
      <Icon name="chatBubble" size={16}/><input ref={input} aria-label="Ask EGM" value={question} onChange={event=>setQuestion(event.target.value)} maxLength={1200} placeholder="Ask about EGM…" required disabled={loading}/>
      <button type="submit" aria-label="Ask" disabled={loading||!question.trim()}><Icon name="sendUp" size={16}/></button><button type="button" aria-label="Close Ask" onClick={close}><Icon name="cross" size={16}/></button>
    </form>,hosts.headerHost)}
    {(loading||error||answer)&&createPortal(<section className="egm-ask-results" aria-label="Ask EGM results">
      {answer?.toolStatus&&<div className="egm-ask-options"><span>{answer.toolStatus.status==='live'?'GitHub checked live':answer.toolStatus.status==='unavailable'?'Live check unavailable. Saved data shown.':'Saved dashboard data'}</span></div>}
      {loading&&<div role="status" aria-live="polite"><p className="egm-note">Reading dashboard data…</p><div className="egm-ask-skeletons" aria-hidden="true">{[0,1,2].map(i=><div key={i}><span/><span/><span/></div>)}</div></div>}
      {error&&<p className="egm-ask-error" role="alert">{error}</p>}
      {answer&&<><div className="egm-ask-answer" aria-live="polite"><p>{answer.answer}</p></div>{answer.cards.length>0&&<div className="egm-ask-cards">{answer.cards.map((card,index)=><AnswerCard key={`${card.queryId}-${index}`} card={card} index={index}/>)}</div>}{answer.sources.length>0&&<details className="egm-ask-sources"><summary>Sources ({answer.sources.length})</summary><ul>{answer.sources.map((source,index)=>{const href=sourceHref(source.url);const label=`[${source.id??index+1}] ${source.label??source.title??source.queryId??'Saved data'}`;return <li key={`${source.id??index}-${source.queryId??''}`}>{href?<a href={href} target="_blank" rel="noreferrer">{label}</a>:<span>{label}</span>}{source.observedAt&&<time dateTime={source.observedAt} title={source.observedAt}> · {new Date(source.observedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'})}</time>}</li>})}</ul></details>}</>}
    </section>,hosts.bodyHost)}
  </>
}
