import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {useChat} from '@ai-sdk/react'
import {createPortal} from 'react-dom'
import {DataComponent,DataTable,EvidenceChart,Icon,useDataApp} from '../../data-app-public.jsx'
import './ask-panel.css'
import {askTableColumns,askCellText} from './ask-table.mjs'
import {AskTransport,answerSections,answerText,askNeedsSignIn,askRetryable,citeId,linkCitations,messageResult,messageText,streamingCitations} from './ask-transport.mjs'
import {percentage} from './percentage.mjs'
import {MessageResponse} from './MessageResponse.jsx'
import {AskStarters} from './AskStarters.jsx'
import {tabIdFromLocation} from './ask-starters.mjs'
import {trackAskOutcome,trackAskStarter} from './usage-analytics.js'

const sourceHref=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}}
const dashboardTabs=new Set(['/overview','/acquisition','/adoption','/website','/development','/research','/mentions'])
function DashboardTabLink({tab,tabLabel}) {
  if(!dashboardTabs.has(tab)||typeof tabLabel!=='string'||!tabLabel)return null
  return <> · <a href={tab}>{tabLabel}</a></>
}
const format=(value,unit)=>typeof value==='number'?unit==='percent'?percentage(value):value.toLocaleString('en-US'):String(value??'Unavailable')
export const shouldDismissAsk=active=>!active
export function AskCompletion({status}) { return <span role="status" className="egm-note">{status==='complete'?'Answer complete.':''}</span> }
function ObservedAt({value,dateOnly=false,bare=false}) {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null
  const options={month:'short',day:'numeric',...(dateOnly?{timeZone:'America/Los_Angeles'}:{hour:'numeric',minute:'2-digit'})}
  return <time dateTime={value} title={value}>{bare?'':' · '}{dateOnly?new Date(value).toLocaleDateString('en-US',options):new Date(value).toLocaleString('en-US',options)}</time>
}

// Ask primitives: every answer type composes these instead of adding one-off markup.
// A chip links to its source row when the answer turn is known; card previews without a turn render it inert.
export function CitationChip({id,messageId,label}) {
  return messageId?<a className="egm-ask-cite" href={`#${citeId(messageId,id)}`} aria-label={`Source ${id}${label?`: ${label}`:''}`}>{id}</a>:<span className="egm-ask-cite">{id}</span>
}
export function MetricGrid({metrics}) {
  return <dl className="egm-ask-metrics">{(metrics??[]).map((metric,i)=><div key={i}><dt>{metric.label}</dt><dd>{format(metric.value,metric.unit)}</dd></div>)}</dl>
}
// Same chip and meta text as the source list so card attribution matches it.
const Attribution=({sourceId,observedAt,turnId,tab,tabLabel})=><p className="egm-ask-attribution">{sourceId&&<CitationChip id={sourceId} messageId={turnId}/>}<span className="egm-ask-source-meta"><ObservedAt value={observedAt} dateOnly bare/><DashboardTabLink tab={tab} tabLabel={tabLabel}/></span></p>

export function LiveMetricCard({card,turnId}) {
  return <section className="egm-ask-live-card"><h3>{card.title}</h3><MetricGrid metrics={card.metrics}/><Attribution sourceId={card.sourceId} observedAt={card.observedAt} turnId={turnId} tab={card.tab} tabLabel={card.tabLabel}/></section>
}

const Mark=({working=false,decorative=false})=><svg className={working?"egm-mark egm-mark--working":"egm-mark"} {...(decorative?{"aria-hidden":true}:{role:"img","aria-label":"EGM"})} viewBox="1.5 5.5 21 13" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path stroke="none" d="M10.30,6.80 A5.20,5.20 0 0 0 10.30,17.20 A1.20,1.20 0 0 0 11.50,16.00 L11.50,8.00 A1.20,1.20 0 0 0 10.30,6.80Z"/><path stroke="none" d="M13.70,6.80 A5.20,5.20 0 0 1 13.70,17.20 A1.20,1.20 0 0 1 12.50,16.00 L12.50,8.00 A1.20,1.20 0 0 1 13.70,6.80Z"/><path fill="none" d="M7.20,12.00 C6.80,14.60 3.40,14.70 3.20,12.60 C3.10,11.20 3.30,10.20 3.60,9.40"/><path fill="none" d="M16.80,12.00 L18.00,12.00 C18.80,12.00 19.40,10.60 20.90,9.40 M18.00,12.00 C18.80,12.00 19.40,13.40 20.90,14.60"/></svg>
const Shimmer=({children})=><span className="egm-shimmer">{children}</span>
const stepIcon={active:<Icon name="spinner" size={14} className="egm-spin"/>,done:<Icon name="check" size={14}/>,skipped:null}
export const messageSteps=message=>(message?.parts??[]).filter(part=>part.type==='data-step').map(part=>part.data)

// AI Elements chain-of-thought: open while running, collapses when done, a user toggle wins.
export function Trace({steps,running,outcome='complete'}) {
  const [choice,setChoice]=useState(null)
  const open=choice??running
  const shown=running?steps:steps.map(step=>step.status==='active'?{...step,status:outcome==='complete'?'done':'skipped'}:step)
  return <div className="egm-trace" data-open={open}>
    <button type="button" className="egm-trace-trigger" aria-expanded={open} onClick={()=>setChoice(!open)}><Mark working={running} decorative/><span role="status">{running?<Shimmer>Thinking</Shimmer>:outcome==='complete'?`Done in ${shown.length} step${shown.length===1?'':'s'}`:outcome==='stopped'?'Stopped':'Interrupted'}</span><Icon name="chevronRight" size={14}/></button>
    {open&&<ol className="egm-trace-steps">
      {!shown.length&&running&&<li><span className="egm-trace-icon">{stepIcon.active}</span><Shimmer>Reading dashboard data…</Shimmer></li>}
      {shown.map(step=><li key={step.id} data-status={step.status}><span className="egm-trace-icon">{stepIcon[step.status]}</span><span className="egm-trace-text">{step.status==='active'?<Shimmer>{step.label}</Shimmer>:step.label}{step.detail&&<span className="egm-trace-detail">{step.detail}</span>}</span></li>)}
    </ol>}
  </div>
}

const seriesColors=['var(--chart-1)','var(--chart-4)','var(--chart-2)']
export function AnswerCard({card,index,turnId}) {
  const {queries}=useDataApp()
  const rows=Array.isArray(card.rows)?card.rows:[]
  const source=queries[card.queryId]
  if(!source)return card.type==='metric'?<LiveMetricCard card={card} turnId={turnId}/>:null
  const props={id:`ask-result-${turnId}-${index}-${card.queryId}`,title:card.title,queryId:source?card.queryId:undefined,sourceRows:source?.rows??rows,displayRows:rows,variant:'card',showActions:Boolean(source)}
  const foot=<Attribution sourceId={card.sourceId} observedAt={card.observedAt} turnId={turnId} tab={card.tab} tabLabel={card.tabLabel}/>
  if(card.type==='chart'&&rows.length&&Array.isArray(card.series)&&card.series.length)return <EvidenceChart {...props} rows={rows} height={210} spec={{type:'line',x:card.xKey??'date',y:card.series[0],fields:card.series,colors:Object.fromEntries(card.series.map((field,index)=>[field,seriesColors[index%seriesColors.length]])),legend:{labels:card.seriesLabels??{}},showXAxisLabel:false,showYAxisLabel:false}}>{foot}</EvidenceChart>
  if(card.type==='table')return <DataComponent {...props} kind="table"><DataTable rows={rows} searchable={false} pageSize={5} columns={askTableColumns(card.columns,rows,card.columnLabels).map(column=>({field:column.field,label:column.label,...(column.clip?{renderCell:(value,row)=>{const {text,tooltip}=askCellText(value,row,column);const href=column.link?sourceHref(row?.url):column.field==='url'?sourceHref(value):null;return <span className="egm-cell-clip" title={tooltip}>{href?<a href={href} target="_blank" rel="noreferrer">{text}</a>:text}</span>}}:{})}))} label={card.title}/>{card.rowsTruncated&&<p className="egm-note">Showing {rows.length} of {card.rowCount} rows.</p>}{foot}</DataComponent>
  if(card.type==='metric')return <DataComponent {...props} kind="custom"><MetricGrid metrics={card.metrics}/>{foot}</DataComponent>
  return null
}

const statusNote=(status,stopped)=>stopped?'Stopped.':status==='submitted'?'Reading dashboard data…':status==='streaming'?'Generating…':status==='error'?'':''
const resultLabel=result=>result.toolStatus?.status==='live'?'Repository totals checked live':result.toolStatus?.status==='unavailable'?'Live repository check unavailable. Saved data shown.':'Saved dashboard data'
export function AskError({message,onRetry}) {
  const text=message||'Could not reach Ask. Try again.'
  return <div className="egm-ask-error" role="alert"><p>{text}</p>{askNeedsSignIn(text)?<button type="button" onClick={()=>location.reload()}>Sign in again</button>:askRetryable(text)&&<button type="button" onClick={onRetry}>Retry</button>}</div>
}
const coarsePointer=()=>typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches

export function CopyButton({text}) {
  const [copied,setCopied]=useState(false)
  const [failed,setFailed]=useState(false)
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1500);return ()=>clearTimeout(timer)},[copied])
  return <><button type="button" onClick={async()=>{setFailed(false);try{await navigator.clipboard.writeText(text);setCopied(true)}catch{setCopied(false);setFailed(true)}}} aria-label={copied?'Copied':'Copy answer'} title={copied?'Copied':'Copy answer'}><Icon name={copied?'check':'copy'} size={16}/></button><span className={failed?'egm-copy-error':'egm-ask-live'} role="status">{failed?'Could not copy. Select the answer to copy it manually.':copied?'Answer copied.':''}</span></>
}

function SourceRow({source,index,messageId}) {
  const id=String(source.id??index+1),href=sourceHref(source.url),label=source.label??source.title??source.queryId??'Saved data'
  const provider=source.provider&&source.provider!==label?source.provider:null
  return <li id={citeId(messageId,id)}><CitationChip id={id}/><span className="egm-ask-source-body">{href?<a href={href} target="_blank" rel="noreferrer">{label}</a>:<span>{label}</span>}<span className="egm-ask-source-meta">{provider??(href?new URL(href).hostname.replace(/^www\./,''):'Dashboard data')}<ObservedAt value={source.observedAt} dateOnly/><DashboardTabLink tab={source.tab} tabLabel={source.tabLabel}/></span></span></li>
}
function SourceList({sources,messageId}) {
  if(!sources.length)return null
  const heading=`ask-sources-${String(messageId).replace(/[^\w-]/g,'')}`
  return <section className="egm-ask-sources-block" aria-labelledby={heading}><h3 className="egm-ask-section-label" id={heading}>Sources</h3><ol className="egm-ask-sources">{sources.map((source,index)=><SourceRow key={`${source.id??index}-${source.queryId??''}`} source={source} index={index} messageId={messageId}/>)}</ol></section>
}
// Streaming and final answers share one section layout, so finishing only adds cards and links instead of reflowing text.
function AnswerBody({text,result,messageId,streaming}) {
  const sections=answerSections(result?text:streamingCitations(text,messageId),result?.cards??[])
  return sections.map((section,i)=><React.Fragment key={i}>
    {section.text.trim()&&<MessageResponse isAnimating={streaming&&i===sections.length-1} components={citationComponents}>{result?linkCitations(section.text,result.sources,messageId):section.text}</MessageResponse>}
    {section.cards.length>0&&<div className="egm-ask-cards">{section.cards.map(({card,index})=><AnswerCard key={`${messageId}-${card.queryId}-${index}`} turnId={messageId} card={card} index={index}/>)}</div>}
  </React.Fragment>)
}

const citationComponents={a:({href,children,node,...props})=>href?.startsWith('#ask-cite-')?<a {...props} href={href} className="egm-ask-cite" aria-label={`Source ${children}`}>{children}</a>:<a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>}

export function AskPanel({open,onClose,initialQuestion=''}) {
  const [question,setQuestion]=useState(initialQuestion)
  const [hosts,setHosts]=useState(null)
  const [stopped,setStopped]=useState(()=>new Set())
  const [atBottom,setAtBottom]=useState(true)
  const transport=useMemo(()=>new AskTransport({onOutcome:trackAskOutcome}),[])
  const {messages,sendMessage,regenerate,stop,status,error,setMessages}=useChat({transport,throttle:50,onFinish:({message,isAbort})=>{if(isAbort)setStopped(previous=>new Set(previous).add(message.id))}})
  const input=useRef(null)
  const bottom=useRef(null)
  const followBottom=useRef(true)
  const busy=status==='submitted'||status==='streaming'
  const latest=messages.at(-1)
  const latestResult=latest?.role==='assistant'?messageResult(latest):null
  const nearBottom=()=>window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-160
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
    // Phones hide the desktop trigger and open Ask from the account menu; mount in the visible top bar instead.
    const headerParent=trigger.offsetParent?trigger.parentElement:trigger.closest('.dashboard-topbar')??trigger.parentElement
    headerParent.append(headerHost)
    const previousDisplay=trigger.style.display
    trigger.style.display='none'
    main.prepend(bodyHost)
    // iOS keeps the layout viewport under the keyboard; lift the sticky composer by the covered height.
    const viewport=window.visualViewport
    const keyboard=()=>bodyHost.style.setProperty('--egm-ask-keyboard',`${Math.max(0,Math.round(window.innerHeight-viewport.height-viewport.offsetTop))}px`)
    viewport?.addEventListener('resize',keyboard)
    viewport?.addEventListener('scroll',keyboard)
    setHosts({headerHost,bodyHost,main})
    return ()=>{viewport?.removeEventListener('resize',keyboard);viewport?.removeEventListener('scroll',keyboard);headerHost.remove();bodyHost.remove();main.classList.remove('egm-ask-page');trigger.style.display=previousDisplay;setHosts(null);trigger.focus()}
  },[open])
  useEffect(()=>{if(open&&initialQuestion)setQuestion(initialQuestion)},[open,initialQuestion])
  useEffect(()=>{if(hosts)input.current?.focus()},[hosts,messages.length>0])
  useEffect(()=>{hosts?.main.classList.toggle('egm-ask-page',messages.length>0)},[hosts,messages.length])
  useLayoutEffect(()=>{if(open&&followBottom.current&&messages.length)bottom.current?.scrollIntoView({block:'end',behavior:'instant'})},[open,messages,status])
  useEffect(()=>{
    if(!open||!hosts)return
    const outside=event=>{if(event.target.closest?.('[role="menu"],[role="dialog"],.source-sidebar'))return;if(!hosts.headerHost.contains(event.target)&&!hosts.bodyHost.contains(event.target)&&shouldDismissAsk(busy))onClose()}
    const escape=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.target.closest?.('[role="menu"],[role="dialog"],.source-sidebar')&&!document.querySelector('.source-sidebar-layer:not(.is-closing)')){event.preventDefault();stop();onClose()}}
    const scroll=()=>{const at=nearBottom();followBottom.current=at;setAtBottom(at)}
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    window.addEventListener('scroll',scroll,{passive:true})
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll)}
  },[open,hosts,onClose,busy,stop])
  function send(value) {
    const text=value.trim()
    if(!text||text.length>1200||busy)return
    followBottom.current=true
    setQuestion('')
    sendMessage({text})
  }
  function jumpToLatest() {
    followBottom.current=true
    bottom.current?.scrollIntoView({block:'end',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
  }
  if(!open||!hosts)return null
  const submit=event=>{event.preventDefault();send(question)}
  const keyDown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&!coarsePointer()){event.preventDefault();send(question)}}
  const action=busy?<button type="button" onClick={stop} aria-label="Stop generating" title="Stop generating"><Icon name="stop" size={18}/></button>:<button type="submit" aria-label="Send question" disabled={!question.trim()}><Icon name="sendUp" size={18}/></button>
  const inline=<form className="egm-ask-inline" onSubmit={submit}>
    <Icon name="gemini" size={16}/><input ref={input} aria-label="Ask Gemini" value={question} onChange={event=>setQuestion(event.target.value)} maxLength={1200} placeholder="Ask about EGM…" enterKeyHint="send" required/>
    {action}<button type="button" aria-label="Close Ask Gemini" onClick={close}><Icon name="cross" size={16}/></button>
  </form>
  const composer=<form className="egm-ask-composer" onSubmit={submit}>
    <textarea ref={input} rows={1} aria-label="Ask a follow-up" value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={keyDown} maxLength={1200} placeholder="Ask a follow-up…" enterKeyHint="send"/>
    {action}
  </form>
  const lastAssistantId=latest?.role==='assistant'?latest.id:null
  const starters=!question.trim()&&<AskStarters tabId={tabIdFromLocation(location.pathname,location.search)} onPick={starter=>{trackAskStarter(starter.id);send(starter.question)}}/>
  return <>
    {createPortal(messages.length?<button className="egm-ask-active-toggle" type="button" onClick={close} aria-label="Close Ask Gemini" title="Close Ask Gemini"><Icon name="gemini" size={18}/></button>:<>{inline}{starters}</>,hosts.headerHost)}
    {messages.length>0&&createPortal(<section className="egm-ask-conversation" aria-label="Ask Gemini conversation">
      <div className="egm-ask-toolbar"><button className="egm-ask-new" type="button" onClick={()=>{stop();setStopped(new Set());setMessages([])}}><Icon name="plus" size={16}/>New chat</button></div>
      <span className="egm-ask-live" aria-live="polite">{statusNote(status,latest&&stopped.has(latest.id))}{status==='ready'&&latestResult?' Answer complete.':''}</span>
      <div className="egm-ask-messages">{messages.map(message=>message.role==='user'
        ?<div className="egm-ask-user" key={message.id}><span className="egm-chat-speaker egm-ask-live">You</span><p>{messageText(message)}</p></div>
        :(()=>{
          const result=messageResult(message)
          const text=answerText(message)
          const streaming=status==='streaming'&&message.id===lastAssistantId
          const steps=messageSteps(message)
          // A stream that failed before any content leaves an empty reply; the error card below explains it.
          if(!streaming&&!text&&!steps.length&&!result&&!stopped.has(message.id))return null
          return <div className="egm-ask-assistant" key={message.id} aria-busy={streaming}>
            {(steps.length>0||streaming)?<><span className="egm-chat-speaker egm-ask-live">EGM</span><Trace steps={steps} running={streaming&&!result} outcome={stopped.has(message.id)?'stopped':result?'complete':'interrupted'}/></>:<span className="egm-chat-speaker"><Mark/></span>}
            {text&&<AnswerBody text={text} result={result} messageId={message.id} streaming={streaming}/>}
            {stopped.has(message.id)&&<p className="egm-note">Stopped. {text?'Partial response.':'No response generated.'}</p>}
            {typeof result?.coverageNote==='string'&&result.coverageNote&&<p className="egm-note">{result.coverageNote}</p>}
            {!streaming&&text&&<div className="egm-ask-actions">{result&&<span className="egm-ask-options">{resultLabel(result)}</span>}<CopyButton text={result?.coverageNote?`${text}\n\n${result.coverageNote}`:text}/>{message.id===lastAssistantId&&!busy&&<button type="button" onClick={()=>{followBottom.current=true;regenerate()}} aria-label="Regenerate answer" title="Regenerate answer"><Icon name="refresh" size={16}/></button>}</div>}
            {result&&<SourceList sources={result.sources} messageId={message.id}/>}
          </div>
        })())}
        {status==='submitted'&&<div className="egm-ask-assistant"><span className="egm-chat-speaker egm-ask-live">EGM</span><Trace steps={[]} running/></div>}
        {status==='error'&&<AskError message={error?.message} onRetry={()=>{followBottom.current=true;regenerate()}}/>}
      </div>
      {status==='ready'&&Array.isArray(latestResult?.suggestedFollowUps)&&<div className="egm-ask-followups">{latestResult.suggestedFollowUps.filter(value=>typeof value==='string'&&value.length<=1200).slice(0,3).map(value=><button type="button" key={value} onClick={()=>send(value)}>{value}<Icon name="arrowUpRight" size={14}/></button>)}</div>}
      <div className="egm-ask-composer-wrap">
        {!atBottom&&<button type="button" className="egm-ask-jump" onClick={jumpToLatest} aria-label="Jump to latest"><Icon name="arrowDown" size={16}/></button>}
        {composer}
        <p className="egm-ask-disclaimer">Answers use dashboard data and can be wrong. Check the sources.</p>
      </div><div className="egm-ask-end" ref={bottom}/>
    </section>,hosts.bodyHost)}
  </>
}
