const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'})
const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN
  const time=Date.parse(value),day=Date.parse(value.slice(0,10)+'T00:00:00Z')
  return Number.isFinite(time)&&Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===value.slice(0,10)?time:NaN
}
const validCounts=row=>['openIssues','openPRs','draftPRs'].every(field=>Number.isSafeInteger(row?.[field])&&row[field]>=0)&&row.draftPRs<=row.openPRs

export function maintenanceHistory(previous,current,observedAt) {
  const collectedAt=timestamp(observedAt)
  if(!validCounts(current)||!Number.isFinite(collectedAt))throw Error('Invalid observed maintenance totals')
  const samples=new Map()
  const add=(row,observedAt,date)=>{
    const time=timestamp(observedAt)
    if(!validCounts(row)||!Number.isFinite(time)||time>collectedAt)return
    const day=pacificDate.format(new Date(time))
    if(date!=null&&date!==day)return
    const saved=samples.get(day)
    if(!saved||time>Date.parse(saved.observedAt))samples.set(day,{date:day,openIssues:row.openIssues,openPRs:row.openPRs,draftPRs:row.draftPRs,observedAt:new Date(time).toISOString()})
  }
  for(const row of previous?.queries?.maintenance_history?.rows??[])add(row,row?.observedAt,row?.date)
  const prior=previous?.queries?.maintenance
  add(prior?.rows?.[0],prior?.source?.executedAt)
  add(current,observedAt)
  const rows=[...samples.values()].sort((a,b)=>a.date.localeCompare(b.date))
  return {
    rows,
    source:{
      label:'GitHub · observed open issues and pull requests',
      provider:'GitHub',
      executedAt:rows.at(-1).observedAt,
      coverage:{startDate:rows[0].date,endDate:rows.at(-1).date},
      metricDefinitions:[
        {label:'Open issues',definition:'Count of currently open GitHub issues, excluding pull requests, at each observation.'},
        {label:'Open PRs',definition:'Count of currently open pull requests, including drafts, at each observation.'},
        {label:'Draft PRs',definition:'Count of currently open draft pull requests at each observation; this is a subset of open PRs.'}
      ],
      caveats:[
        'Retains the latest successful observation per America/Los_Angeles calendar date, with its actual timestamp. These are point-in-time queue sizes, not daily opening or closure counts.',
        'Queue sizes may increase or decrease. The current sampling day is partial; missing sampling dates are unknown, never zero-filled.',
        'History begins with actual stored maintenance observations. Earlier queue sizes cannot be reconstructed from current issue and pull-request states.'
      ],
      links:[{label:'Issues',url:'https://github.com/google/elephant-goldfish-model/issues'},{label:'Pull requests',url:'https://github.com/google/elephant-goldfish-model/pulls'}],
      evidenceFlow:[{title:'Observed maintenance queue sizes',detail:'Reuses the existing paginated GitHub issues and pull requests responses. Filters issues to exclude pull requests, then counts records with state=open. No additional API requests.'}]
    }
  }
}
