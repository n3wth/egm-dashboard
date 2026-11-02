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
