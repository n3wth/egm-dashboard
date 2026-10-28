export function weeklyChange(rows,field) {
  if(!['views','clones'].includes(field))return null
  const days=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-14)
  if(days.length!==14||days.some((row,index)=>!Number.isFinite(row[field])||row[field]<0||!Number.isFinite(Date.parse(row.date))||(index>0&&Date.parse(row.date)-Date.parse(days[index-1].date)!==86400000)))return null
  const previous=days.slice(0,7).reduce((total,row)=>total+row[field],0)
  const current=days.slice(7).reduce((total,row)=>total+row[field],0)
  return previous>0?{change:(current/previous-1)*100,previous,current,start:days[0].date,mid:days[7].date,end:days[13].date}:null
}

export function starWeeklyChange(rows,observedAt) {
  const timestamp=Date.parse(observedAt)
  if(!Number.isFinite(timestamp))return null
  const partialDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp))
  const days=[...rows].filter(row=>row.date<partialDate).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-15)
  if(days.length!==15||days.some((row,index)=>!Number.isFinite(row.stars)||row.stars<0||!Number.isFinite(Date.parse(row.date))||(index>0&&(Date.parse(row.date)-Date.parse(days[index-1].date)!==86400000||row.stars<days[index-1].stars))))return null
  const previous=days[7].stars-days[0].stars
  const current=days[14].stars-days[7].stars
  return previous>0?{change:(current/previous-1)*100,previous,current,start:days[1].date,mid:days[8].date,end:days[14].date,reconstructed:true}:null
}
