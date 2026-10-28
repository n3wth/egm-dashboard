const day = 86400000
const date = value => value && Number.isInteger(value.year) && Number.isInteger(value.month) && Number.isInteger(value.day) ? `${value.year}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}` : null

export async function collectSitePerformance(env, request = fetch, previous = {}, time = Date.now()) {
  const at = new Date(time).toISOString()
  const active = Number.isFinite(Date.parse(env.REFRESH_UNTIL)) && time < Date.parse(env.REFRESH_UNTIL)
  const old = previous.site_performance
  const saved = new Map((old?.rows ?? []).map(row => [row.kind, {...row}]))
  const sources = [
    {kind:'Lab', url:'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fegm.dev%2F&strategy=mobile', init:{}, parse: data => {
      const score = data.lighthouseResult?.categories?.performance?.score
      if (!Number.isFinite(score) || score < 0 || score > 1) throw Error('invalid_score')
      return {score:Math.round(score*100)}
    }},
    {kind:'Field', url:'https://chromeuxreport.googleapis.com/v1/records:queryRecord', init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({origin:'https://egm.dev',formFactor:'PHONE'})}, parse: data => {
      const record=data.record, metrics=record?.metrics, collection=record?.collectionPeriod
      const lcp=metrics?.largest_contentful_paint?.percentiles?.p75
      const inp=metrics?.interaction_to_next_paint?.percentiles?.p75
      const rawCls=metrics?.cumulative_layout_shift?.percentiles?.p75
      const cls=rawCls == null || rawCls === '' ? null : Number(rawCls)
      if (![lcp,inp,cls].some(Number.isFinite)) throw Error('no_metrics')
      return {lcp:Number.isFinite(lcp)?lcp:null,inp:Number.isFinite(inp)?inp:null,cls:Number.isFinite(cls)?cls:null,periodStart:date(collection?.firstDate),periodEnd:date(collection?.lastDate)}
    }}
  ]
  for (const source of sources) {
    const prior=saved.get(source.kind)
    if (!active || !env.GOOGLE_PERFORMANCE_API_KEY || (prior?.lastAttemptAt && time-Date.parse(prior.lastAttemptAt)<day)) continue
    const row={...prior,kind:source.kind,lastAttemptAt:at,status:'unavailable'}
    try {
      const response=await request(source.url,{...source.init,headers:{...source.init.headers,'x-goog-api-key':env.GOOGLE_PERFORMANCE_API_KEY},redirect:'error',signal:AbortSignal.timeout(60000)})
      if (!response.ok) throw Error('unavailable')
      Object.assign(row,source.parse(await response.json()),{status:'available',observedAt:at})
    } catch {}
    saved.set(source.kind,row)
  }
  const rows=sources.map(source=>saved.get(source.kind) ?? {kind:source.kind,status:active && env.GOOGLE_PERFORMANCE_API_KEY?'pending':'unavailable'})
  const source={label:'Google · website performance',provider:'Google',executedAt:at,links:[{label:'PageSpeed Insights',url:'https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fegm.dev%2F'},{label:'Chrome UX Report',url:'https://developer.chrome.com/docs/crux/'}],metricDefinitions:[{label:'Mobile lab score',definition:'Lighthouse performance score for the egm.dev homepage, out of 100.'},{label:'Field metrics',definition:'75th percentile of real Chrome experiences on phones across the egm.dev origin during the reported CrUX collection period.'}],caveats:['Lab measurements are a single test and are not real-user data. CrUX covers eligible Chrome users and is not all visitors.','Failed refreshes retain prior readings and their original observation time. Each source is attempted at most once per 24 hours during the existing refresh window.']}
  return {site_performance:{rows,source:rows.every(row=>row.lastAttemptAt!==at)&&old?.source?old.source:source}}
}
