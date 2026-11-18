import {ANALYSIS_QUESTION,analyzeObservedStars} from '../egm-performance/src/content/dashboard/ask-analysis.mjs'
import {dashboardTab} from './ask-tabs.mjs'

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'}
const normalize=value=>value.trim().replace(/\s+/g,' ').replace(/\s*\?$/,'').toLowerCase()
const supported=normalize(ANALYSIS_QUESTION)
const repository='https://github.com/google/elephant-goldfish-model'
const title='Observed repository star totals'
const n=value=>Math.abs(value).toLocaleString('en-US')
const signed=value=>(value>0?'+':value<0?'-':'')+n(value)
const stars=value=>`${value<0?'-':''}${n(value)} ${Math.abs(value)===1?'star':'stars'}`

/** Only the exact starter text, ignoring case, whitespace and one trailing question mark. */
export function isAnalysisQuestion(question) {
  return typeof question==='string'&&normalize(question)===supported
}

/** Deterministic Ask result for the observed star comparison; never calls a model or the network. */
export function analysisResult(snapshot,now=Date.now(),snapshotAt=snapshot?.generatedAt??null) {
  const query=snapshot?.queries?.star_observations
  const observed=query!=null&&typeof query==='object'
  const {calculation,rows}=analyzeObservedStars(query,now)
  const tab=dashboardTab('star_observations')
  const provider=observed&&typeof query.source?.label==='string'&&query.source.label.trim()?query.source.label.trim().slice(0,200):'GitHub'
  const sources=observed?[{id:'1',title,label:title,provider,queryId:'star_observations',observedAt:calculation.observedAt,coverage:calculation.availableRange,...tab,url:repository}]:[]
  const cite=observed?' [1]':''
  const complete=calculation.status==='complete'
  const range=calculation.availableRange?` Retained valid observations cover ${calculation.availableRange.startDate} to ${calculation.availableRange.endDate}.`:''
  const answer=complete
    ?`EGM's observed net star change was ${stars(calculation.current)} over the latest 7 closed sampling intervals, compared with ${stars(calculation.previous)} over the previous 7, a signed difference of ${signed(calculation.difference)} ${Math.abs(calculation.difference)===1?'star':'stars'}${cite}.`
    :`The observed net star comparison is unavailable. ${calculation.reason}${range}${cite}`
  const coverageNote=complete
    ?'Each interval runs between the latest retained samples on consecutive Pacific dates, not an exact midnight-to-midnight day. This measures net change in observed repository totals; Overview may show reconstructed new stars from current stargazers, so the figures can differ.'
    :'No comparison was calculated. Missing observations are not reconstructed or filled with zeros.'
  const cards=complete?[{type:'chart',calculated:true,queryId:'star_observations',title:'Observed net star change',sourceId:'1',observedAt:calculation.observedAt,xKey:'date',series:['netStars'],seriesLabels:{netStars:'Net stars'},rows,rowCount:rows.length,rowsTruncated:false,...tab}]:[]
  return {answer,cards,sources,suggestedFollowUps:['How has EGM star growth changed?','Which channels bring visitors to EGM?'],coverageNote,toolStatus:{name:'GitHub repository',status:'cached'},snapshotAt,generatedAt:new Date(now).toISOString(),calculation}
}

/** One existing-protocol NDJSON result event; an already aborted request closes without a result. */
export function analysisStream(result,signal) {
  const body=new ReadableStream({
    pull(controller) {
      if(!signal?.aborted)controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'result',...result})+'\n'))
      controller.close()
    }
  })
  return new Response(body,{headers:{'content-type':'application/x-ndjson; charset=utf-8',...headers}})
}
