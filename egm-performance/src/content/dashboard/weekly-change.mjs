import {observedStarGrowth} from './star-growth.mjs'

const n=value=>Math.round(value).toLocaleString('en-US')
const comparison=(previous,current,dates)=>({change:previous>0?(current/previous-1)*100:null,previous,current,...dates})

export function weeklyChange(rows,field) {
  if(!['views','clones','mergedPRs'].includes(field))return null
  const days=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-14)
  if(days.length!==14||days.some((row,index)=>!Number.isFinite(row[field])||row[field]<0||!Number.isFinite(Date.parse(row.date))||(index>0&&Date.parse(row.date)-Date.parse(days[index-1].date)!==86400000)))return null
  const previous=days.slice(0,7).reduce((total,row)=>total+row[field],0)
  const current=days.slice(7).reduce((total,row)=>total+row[field],0)
  return comparison(previous,current,{start:days[0].date,mid:days[7].date,end:days[13].date})
}

export function starWeeklyChange(rows,observedAt) {
  const timestamp=Date.parse(observedAt)
  if(!Number.isFinite(timestamp))return null
  const partialDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp))
  const days=[...rows].filter(row=>row.date<partialDate).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-15)
  if(days.length!==15||days.some((row,index)=>!Number.isFinite(row.stars)||row.stars<0||!Number.isFinite(Date.parse(row.date))||(index>0&&(Date.parse(row.date)-Date.parse(days[index-1].date)!==86400000||row.stars<days[index-1].stars))))return null
  const previous=days[7].stars-days[0].stars
  const current=days[14].stars-days[7].stars
  return {...comparison(previous,current,{start:days[1].date,mid:days[8].date,end:days[14].date}),reconstructed:true}
}

export function observedStarChange(rows,observedAt) {
  const days=observedStarGrowth(rows,observedAt).daily.filter(row=>row.coverage==='Closed sampling day').slice(-15)
  if(days.length!==15||days.some((row,index)=>index>0&&(!Number.isFinite(row.netStars)||row.fromObservedAt!==days[index-1].observedAt)))return null
  const previous=days[7].stars-days[0].stars
  const current=days[14].stars-days[7].stars
  return {...comparison(previous,current,{start:days[0].date,mid:days[7].date,end:days[14].date,startObservedAt:days[0].observedAt,midObservedAt:days[7].observedAt,endObservedAt:days[14].observedAt}),observed:true,reconstructed:false}
}

/**
 * The percentage is only meaningful while the baseline week is large enough to support it (at least 100 and not more
 * than a tenfold change); a surge from a near-empty or empty baseline is reported as the absolute difference instead
 * of "+51,119%" or nothing at all.
 */
export function weeklyDelta(weekly) {
  if(!weekly)return null
  const difference=weekly.current-weekly.previous
  const direction=difference>0?'up':difference<0?'down':'flat'
  if(direction==='flat')return {direction,text:'No change'}
  const meaningful=weekly.change!=null&&weekly.previous>=100&&Math.abs(weekly.change)<=1000
  const sign=difference>0?'+':'−'
  return {direction,text:meaningful?`${sign}${n(Math.abs(weekly.change))}%`:`${sign}${n(Math.abs(difference))}`}
}

export function weeklyChangeLabel(weekly,noun) {
  if(!weekly)return null
  return `${n(weekly.current)}${noun?' '+noun:''} last 7d · ${n(weekly.previous)} prior 7d`
}
