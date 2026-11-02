export function starGrowth(rows, observedAt) {
  const timestamp=Date.parse(observedAt)
  const partialDate=Number.isFinite(timestamp)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp)):null
  const sorted=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  const daily=sorted.map((row,index)=>{
    const previous=sorted[index-1]
    const valid=previous&&Number.isFinite(row.stars)&&Number.isFinite(previous.stars)&&previous.stars>=0&&row.stars>=previous.stars&&Date.parse(row.date)-Date.parse(previous.date)===86400000
    const gained=valid?row.stars-previous.stars:null
    const complete=partialDate!=null&&row.date<partialDate
    return {...row,newStars:complete?gained:null,partialStars:row.date===partialDate?gained:null,coverage:complete?'Complete day':row.date===partialDate?'Partial day':'Coverage unknown'}
  })
  const cutoff=Date.parse(sorted.at(-1)?.date)-13*86400000
  const recent=daily.filter(row=>Date.parse(row.date)>=cutoff)
  return {daily,recent,hiddenDays:daily.length-recent.length}
}

const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'})
const observationTime=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN
  const time=Date.parse(value),day=Date.parse(value.slice(0,10)+'T00:00:00Z')
  return Number.isFinite(time)&&Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===value.slice(0,10)?time:NaN
}

export function observedStarGrowth(rows,observedAt) {
  const time=observationTime(observedAt)
  const partialDate=Number.isFinite(time)?pacificDate.format(new Date(time)):null
  const samples=new Map()
  for(const row of rows??[]) {
    const sampledAt=observationTime(row?.observedAt)
    if(!Number.isSafeInteger(row?.stars)||row.stars<0||!Number.isFinite(sampledAt)||(Number.isFinite(time)&&sampledAt>time)||row.date!==pacificDate.format(new Date(sampledAt)))continue
    const saved=samples.get(row.date)
    if(!saved||sampledAt>Date.parse(saved.observedAt))samples.set(row.date,row)
  }
  const sorted=[...samples.values()].sort((a,b)=>a.date.localeCompare(b.date))
  const daily=sorted.map((row,index)=>{
    const previous=sorted[index-1]
    const consecutive=previous&&Date.parse(row.date)-Date.parse(previous.date)===86400000&&Date.parse(row.observedAt)>Date.parse(previous.observedAt)
    const net=consecutive?row.stars-previous.stars:null
    const closed=partialDate!=null&&row.date<partialDate
    return {...row,netStars:closed?net:null,partialNetStars:row.date===partialDate?net:null,fromObservedAt:consecutive?previous.observedAt:null,coverage:closed?'Closed sampling day':row.date===partialDate?'Partial sampling day':'Coverage unknown'}
  })
  const cutoff=Date.parse(sorted.at(-1)?.date)-13*86400000
  const recent=daily.filter(row=>Date.parse(row.date)>=cutoff)
  return {daily,recent,hiddenDays:daily.length-recent.length}
}
