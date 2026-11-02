import {formatObservedAt} from './collection-status.mjs'

const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'})

export function savedAnalysis(queries,id,now=Date.now()) {
  const query=queries.daily_analysis,row=query?.rows?.find(row=>row.id===id),source=query?.source
  const generated=Date.parse(source?.executedAt)
  if(!row||!Number.isFinite(generated)||generated>now||!['headline','summary','nextStep'].every(field=>typeof row[field]==='string')||!Array.isArray(row.queryIds)||row.queryIds.some(queryId=>!queries[queryId])||!Array.isArray(row.unknowns)||row.unknowns.some(text=>typeof text!=='string')||!Array.isArray(source.inputSources))return null
  const status=queries.daily_analysis_status?.rows?.[0]
  const newerSources=row.queryIds.some(id=>{
    const before=Date.parse(source.inputSources.find(record=>record.queryId===id)?.observedAt)
    const current=Date.parse(queries[id]?.source?.executedAt)
    return Number.isFinite(current)&&(!Number.isFinite(before)||current>before)
  })
  const changedInputs=typeof status?.inputFingerprint==='string'&&status.inputFingerprint!==source.inputFingerprint
  const stale=pacificDate.format(new Date(generated))!==pacificDate.format(new Date(now))||newerSources||changedInputs||['stale','expired','failed','unavailable'].includes(status?.status)
  return {...row,generatedAt:source.executedAt,generatedLabel:formatObservedAt(source.executedAt),model:source.model,stale,newerSources:newerSources||changedInputs}
}

export function analysisSummary(summary,queries,id,now) {
  const analysis=savedAnalysis(queries,id,now)
  if(!analysis)return summary?{...summary,analysis:null}:null
  const notes=[...(summary?.notes??summary?.sentences??[]),`Proposed next step: ${analysis.nextStep}`,...analysis.unknowns.map(text=>`Unknown: ${text}`),`Saved Gemini interpretation generated ${analysis.generatedLabel}. Confidence: ${analysis.confidence}; this is not a calibrated probability.`,...(analysis.newerSources?['The cited source observations have changed since this analysis was generated.']:[])]
  return {...summary,headline:analysis.headline,facts:[analysis.summary],notes,queryIds:[...new Set(['daily_analysis',...analysis.queryIds,...(summary?.queryIds??[])])],analysis}
}
