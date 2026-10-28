export function weeklyChange(rows,field) {
  if(!['views','clones'].includes(field))return null
  const days=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-14)
  if(days.length!==14||days.some((row,index)=>!Number.isFinite(row[field])||row[field]<0||!Number.isFinite(Date.parse(row.date))||(index>0&&Date.parse(row.date)-Date.parse(days[index-1].date)!==86400000)))return null
  const previous=days.slice(0,7).reduce((total,row)=>total+row[field],0)
  const current=days.slice(7).reduce((total,row)=>total+row[field],0)
  return previous>0?{change:(current/previous-1)*100,previous,current,start:days[0].date,mid:days[7].date,end:days[13].date}:null
}
