const cache=new WeakMap()
const origins={'https://us.i.posthog.com':'https://us.posthog.com','https://eu.i.posthog.com':'https://eu.posthog.com'}

export async function userActivity(env,users,request=fetch) {
  const ids=users.map(user=>user.id).filter(id=>/^user_[A-Za-z0-9]+$/.test(id)).sort()
  const unavailable={status:'unavailable',windowDays:30,users:{}}
  const origin=origins[env.POSTHOG_HOST]
  if(!origin||!env.POSTHOG_QUERY_KEY||!/^\d+$/.test(env.POSTHOG_PROJECT_ID??'')||!ids.length)return unavailable
  const key=JSON.stringify(ids),previous=cache.get(env)
  if(previous?.key===key&&previous.expires>Date.now())return previous.value
  try {
    const response=await request(`${origin}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
      headers:{authorization:`Bearer ${env.POSTHOG_QUERY_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({query:{kind:'HogQLQuery',query:`SELECT distinct_id, max(timestamp), countIf(event = '$pageview'), uniqExact(toDate(toTimeZone(timestamp, 'America/Los_Angeles'))), countIf(event = 'dashboard_ask' AND properties.outcome = 'submitted')
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY AND timestamp <= now()
  AND event IN ('$pageview', 'dashboard_section_viewed', 'dashboard_ask')
  AND properties.$current_url LIKE 'https://egm.n3wth.com/%'
  AND distinct_id IN (${ids.map(id=>`'${id}'`).join(',')})
GROUP BY distinct_id LIMIT 200`}})
    })
    if(!response.ok)throw Error('activity_unavailable')
    const body=await response.json()
    if(body.error||body.hasMore||body.query_status?.complete===false||!Array.isArray(body.results)||body.results.length>200)throw Error('invalid_activity')
    const result={status:'available',windowDays:30,asOf:new Date().toISOString(),users:{}}
    const allowed=new Set(ids)
    for(const row of body.results) {
      if(!Array.isArray(row)||row.length!==5||!allowed.has(row[0]))continue
      const [id,lastSeen,pageViews,activeDays,questions]=row
      const date=typeof lastSeen==='string'?new Date(lastSeen):null
      if(!date||!Number.isFinite(date.getTime())||date.getTime()>Date.now()+60000||date.getTime()<Date.now()-31*86400000||![pageViews,activeDays,questions].every(value=>Number.isSafeInteger(value)&&value>=0)||activeDays>31)throw Error('invalid_activity')
      result.users[id]={lastSeen:date.toISOString(),pageViews,activeDays,questions}
    }
    cache.set(env,{key,value:result,expires:Date.now()+300000})
    return result
  } catch {
    cache.set(env,{key,value:unavailable,expires:Date.now()+30000})
    return unavailable
  }
}
