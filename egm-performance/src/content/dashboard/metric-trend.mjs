// Align calendar labels without changing each source's UTC or Pacific day definition.
export function chartDates(rows,now=Date.now()) {
  const dates=rows.map(row=>row.date).filter(date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date).sort()
  if(!dates.length)return []
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
  const start=Date.parse(dates[0]),end=Math.max(Date.parse(dates.at(-1)),Date.parse(today))
  return Array.from({length:Math.round((end-start)/86400000)+1},(_,index)=>new Date(start+index*86400000).toISOString().slice(0,10))
}

export function alignedTrendValues(history,field,dates) {
  const values=new Map(history.map(row=>[row.date,row[field]]))
  return dates.map(date=>Number.isFinite(values.get(date))?values.get(date):null)
}

export function sampledTrendValues(history,field) {
  const dates=history.map(row=>row.date).filter(date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date).sort()
  if(!dates.length)return []
  const end=Date.parse(dates.at(-1))
  return alignedTrendValues(history,field,Array.from({length:14},(_,index)=>new Date(end-(13-index)*86400000).toISOString().slice(0,10)))
}
