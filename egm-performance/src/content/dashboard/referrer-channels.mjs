// One place that turns GitHub's raw referrer strings into the channel names the dashboard shows.
const channels={Google:'Google','google.com':'Google','youtube.com':'YouTube','m.youtube.com':'YouTube','www.youtube.com':'YouTube','youtu.be':'YouTube','linkedin.com':'LinkedIn','com.linkedin.android':'LinkedIn','github.com':'GitHub','teams.public.onecdn.static.microsoft':'Teams','teams.microsoft.com':'Teams','l.threads.com':'Threads','threads.com':'Threads','threads.net':'Threads',Bing:'Bing','bing.com':'Bing',DuckDuckGo:'DuckDuckGo','duckduckgo.com':'DuckDuckGo','egm.dev':'egm.dev'}
const searchVideo=new Set(['Google','YouTube'])

export function channelOf(referrer) {
  const key=String(referrer??'')
  return channels[key]??channels[key.toLowerCase()]??key
}

export const isSearchVideo=referrer=>searchVideo.has(channelOf(referrer))

/** Groups referrer rows by channel and sorts by views. Unique visitors are not summed: GitHub cannot deduplicate them across sources. */
export function channelViews(rows) {
  const groups=new Map()
  for(const row of rows??[]) {
    if(!Number.isFinite(row?.count)||row.count<0)continue
    const channel=channelOf(row.referrer)
    groups.set(channel,(groups.get(channel)??0)+row.count)
  }
  return [...groups].map(([source,count])=>({source,count})).sort((a,b)=>b.count-a.count)
}
