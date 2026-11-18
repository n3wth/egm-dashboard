import {observedStarChange} from './weekly-change.mjs'
import {observedStarGrowth} from './star-growth.mjs'

export const ANALYSIS_QUESTION='Compare EGM net star growth over the last 7 complete sampling days with the previous 7?'
const id='observed-net-stars-7d'
const timeZone='America/Los_Angeles'
// Matches the collector's stored definition in egm-cloudflare/star-observations.mjs.
const fallbackDefinition='The difference between dated repository-total samples. Totals can rise or fall; this does not count individual star or unstar events.'
const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})
const reasons={
  missing:'No retained repository star observations are available.',
  invalidTime:'The star observation source time is missing, invalid or later than the request time.',
  insufficient:'Fewer than 15 consecutive valid closed sampling days are retained, or the retained history has gaps.'
}

const sourceTime=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN
  const time=Date.parse(value),day=Date.parse(value.slice(0,10)+'T00:00:00Z')
  return Number.isFinite(time)&&Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===value.slice(0,10)?time:NaN
}

// Date-only arithmetic on the Pacific calendar date, so DST transitions cannot shift the result.
function pacificYesterday(now) {
  const [year,month,day]=pacificDate.format(new Date(now)).split('-').map(Number)
  return new Date(Date.UTC(year,month-1,day-1)).toISOString().slice(0,10)
}

function definitionOf(source) {
  const entry=Array.isArray(source?.metricDefinitions)?source.metricDefinitions.find(item=>item?.label==='Observed net star change'):null
  return typeof entry?.definition==='string'&&entry.definition.trim()?entry.definition.trim().slice(0,600):fallbackDefinition
}

const unavailable=(base,reason,availableRange=null)=>({calculation:{...base,status:'unavailable',availableRange,reason,boundaries:[]},rows:[]})

/** Thin wrapper over observedStarChange/observedStarGrowth; caller supplies request time in ms. */
export function analyzeObservedStars(query,now=Date.now()) {
  const source=query&&typeof query==='object'?query.source:null
  const base={id,definition:definitionOf(source),timeZone,observedAt:null}
  const rows=query&&typeof query==='object'&&Array.isArray(query.rows)?query.rows:null
  if(!rows?.length)return unavailable(base,reasons.missing)
  const time=sourceTime(source?.executedAt)
  if(!Number.isFinite(time)||!Number.isFinite(now)||time>now)return unavailable(base,reasons.invalidTime)
  const observedAt=source.executedAt
  base.observedAt=new Date(time).toISOString()
  const growth=observedStarGrowth(rows,observedAt)
  const samples=growth.daily.filter(row=>Number.isFinite(row.stars))
  const availableRange=samples.length?{startDate:samples[0].date,endDate:samples.at(-1).date}:null
  const result=observedStarChange(rows,observedAt)
  if(!result)return unavailable(base,reasons.insufficient,availableRange)
  const expected=pacificYesterday(now)
  if(result.end!==expected)return unavailable(base,`The latest closed sampling day is ${result.end}, but ${expected} is required.`,availableRange)
  // Same window observedStarChange compared: the last 15 closed sampling days.
  const days=growth.daily.filter(row=>row.coverage==='Closed sampling day').slice(-15)
  const boundary=(label,row)=>({label,date:row.date,observedAt:row.observedAt,stars:row.stars})
  return {
    calculation:{...base,status:'complete',availableRange,reason:null,boundaries:[boundary('Previous start',days[0]),boundary('Period boundary',days[7]),boundary('Latest end',days[14])],previous:result.previous,current:result.current,difference:result.current-result.previous},
    rows:days.slice(1).map(row=>({date:row.date,netStars:row.netStars}))
  }
}
