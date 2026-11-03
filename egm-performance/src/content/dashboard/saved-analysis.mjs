import {formatObservedAt} from './collection-status.mjs'

const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'})

export function audienceSentiment(queries,now=Date.now()) {
  const comments=new Set(),videos=new Set()
  for(const row of queries.youtube_comments?.rows??[]) {
    for(const comment of row.comments??[]) {
      if(typeof comment.text!=='string'||!comment.text.trim())continue
      comments.add(`${row.videoId}:${comment.id||comment.text}`)
      videos.add(row.videoId)
    }
  }
  const saved=savedAnalysis(queries,'mentions',now)
  const analysis=comments.size&&saved&&!saved.stale&&saved.queryIds.includes('youtube_comments')?saved:null
  return {comments:comments.size,videos:videos.size,analysis}
}

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
  const evidenceQueryIds=row.queryIds.map(id=>'daily_analysis_input_'+id)
  if(evidenceQueryIds.some(id=>!queries[id]))return null
  return {...row,evidenceQueryIds,generatedAt:source.executedAt,generatedLabel:formatObservedAt(source.executedAt),model:source.model,stale,newerSources:newerSources||changedInputs}
}

export function analysisSummary(summary,queries,id,now) {
  const analysis=savedAnalysis(queries,id,now)
  if(!analysis)return summary?{...summary,analysis:null}:null
  if(analysis.stale)return summary?{...summary,analysis:null,previousAnalysis:analysis,notes:[...(summary.notes??summary.sentences??[]),'An earlier saved interpretation is not used here because its observations changed or it is no longer current.']}:null
  const notes=[...(summary?.notes??summary?.sentences??[]),`Proposed next step: ${analysis.nextStep}`,...analysis.unknowns.map(text=>`Unknown: ${text}`),`Saved Gemini interpretation generated ${analysis.generatedLabel}. Confidence: ${analysis.confidence}; this is not a calibrated probability.`,...(analysis.newerSources?['The cited source observations have changed since this analysis was generated.']:[])]
  return {...summary,headline:analysis.headline,facts:[analysis.summary],notes,queryIds:['daily_analysis',...analysis.evidenceQueryIds],analysis}
}
