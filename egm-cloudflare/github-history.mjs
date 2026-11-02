// Keep daily counts separate from overlapping rolling-window observations.
export function retainGithubHistory(previous, latest) {
  const history=structuredClone(previous.githubHistory??{daily:{},windows:[]})
  for(const id of ['traffic','activity']) {
    const days=new Map((history.daily[id]??[]).map(row=>[row.date,row]))
    for(const snapshot of [previous,latest]) {
      const query=snapshot.queries?.[id]
      for(const row of query?.rows??[]) {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date)))throw Error('Invalid historical date')
        days.set(row.date,{...row,observedAt:query.source?.executedAt??snapshot.generatedAt})
      }
    }
    history.daily[id]=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date))
  }
  const windows=new Map(history.windows.map(row=>[row.observedAt.slice(0,10),row]))
  for(const snapshot of [previous,latest]) {
    const observedAt=snapshot.queries?.traffic?.source?.executedAt
    if(!Number.isFinite(Date.parse(observedAt)))continue
    const day=observedAt.slice(0,10)
    if(windows.get(day)?.observedAt>observedAt)continue
    windows.set(day,{observedAt,queries:Object.fromEntries(['reach','referrers','paths','downloads','website','website_contribution'].filter(id=>snapshot.queries?.[id]).map(id=>[id,structuredClone(snapshot.queries[id])]))})
  }
  history.windows=[...windows.values()].sort((a,b)=>a.observedAt.localeCompare(b.observedAt))
  history.definition='Daily traffic and activity by UTC date; latest observed value replaces overlapping dates. Windows retain the latest observation per UTC collection day, with original source metadata. Window totals and unique visitors must not be summed across overlapping periods. No automatic history expiry.'
  return history
}
