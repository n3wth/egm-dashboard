// Snapshots refresh every 30 minutes; more than 36 hours old means collection has stopped working.
export function staleness(generatedAt,now=Date.now(),thresholdHours=36) {
  const time=Date.parse(generatedAt)
  if(!Number.isFinite(time))return null
  const hours=Math.floor((now-time)/3600000)
  if(hours<thresholdHours)return null
  const days=Math.floor(hours/24)
  return {hours,label:days>=2?`${days} days ago`:`${hours} hours ago`}
}

// Unknown values never render as "NaN" or "0".
export const count=value=>value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString('en-US'):'Unavailable'
