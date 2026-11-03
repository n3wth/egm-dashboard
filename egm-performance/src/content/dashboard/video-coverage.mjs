export function videoId(value) {
  try {
    const url=new URL(value)
    if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname))return null
    const id=url.hostname==='youtu.be'?url.pathname.split('/')[1]:url.searchParams.get('v')??url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]
    return /^[A-Za-z0-9_-]{11}$/.test(id??'')?id:null
  } catch {return null}
}

export function videoCoverage(queries) {
  const ids=new Set(),queryIds=['youtube_videos']
  const metadata=queries.youtube_videos?.rows??[]
  metadata.forEach(row=>{const id=videoId(row.url)??row.videoId;if(id)ids.add(id)})
  for(const key of ['mentions','exa_mentions','tavily_mentions','parallel_mentions']) {
    const videos=(queries[key]?.rows??[]).map(row=>videoId(row.url)).filter(Boolean)
    if(videos.length)queryIds.push(key)
    videos.forEach(id=>ids.add(id))
  }
  return {discovered:Math.max(ids.size,metadata.length),queryIds}
}
