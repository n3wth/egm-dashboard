const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'})
const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN
  const time=Date.parse(value),day=Date.parse(value.slice(0,10)+'T00:00:00Z')
  return Number.isFinite(time)&&Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===value.slice(0,10)?time:NaN
}

export function starObservations(previous,stars,observedAt) {
  const collectedAt=timestamp(observedAt)
  if(!Number.isSafeInteger(stars)||stars<0||!Number.isFinite(collectedAt))throw Error('Invalid observed repository star total')
  const samples=new Map()
  const add=(stars,observedAt,date)=>{
    const time=timestamp(observedAt)
    if(!Number.isSafeInteger(stars)||stars<0||!Number.isFinite(time)||time>collectedAt)return
    const day=pacificDate.format(new Date(time))
    if(date!=null&&date!==day)return
    const saved=samples.get(day)
    if(!saved||time>Date.parse(saved.observedAt))samples.set(day,{date:day,stars,observedAt:new Date(time).toISOString()})
  }
  for(const row of previous?.queries?.star_observations?.rows??[])add(row?.stars,row?.observedAt,row?.date)
  const addReach=query=>add(query?.rows?.[0]?.stars,query?.source?.executedAt)
  addReach(previous?.queries?.reach)
  for(const window of previous?.githubHistory?.windows??[])addReach(window?.queries?.reach)
  add(stars,observedAt)
  const rows=[...samples.values()].sort((a,b)=>a.date.localeCompare(b.date))
  return {
    rows,
    source:{
      label:'GitHub · observed repository star totals',
      provider:'GitHub',
      executedAt:rows.at(-1).observedAt,
      coverage:{startDate:rows[0].date,endDate:rows.at(-1).date},
      metricDefinitions:[
        {label:'Observed stars',definition:'Actual stargazers_count from the repository response. Retains the latest valid observed total per America/Los_Angeles calendar date.'},
        {label:'Observed net star change',definition:'The difference between dated repository-total samples. Totals can rise or fall; this does not count individual star or unstar events.'}
      ],
      caveats:[
        'Daily samples are the latest successful observations on each Pacific date, not exact midnight totals. Actual observation timestamps are retained.',
        'The latest sampling date is partial. Missing sampling dates are unknown, never zero-filled.',
        'Historical bootstrap uses only actual dated reach observations. Reconstructed current-stargazer history is a separate measurement and is not added to these totals.'
      ],
      links:[{label:'Repository',url:'https://github.com/google/elephant-goldfish-model'}],
      evidenceFlow:[{title:'Observed repository totals',detail:'GET https://api.github.com/repos/google/elephant-goldfish-model → stargazers_count. Earlier samples retain actual reach observation timestamps from stored snapshots.'}]
    }
  }
}
