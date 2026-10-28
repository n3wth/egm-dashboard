// Display-only grouping. Query strings distinguish source pages (for example HN pagination).
export function backlinkPages(rows) {
  const pages=new Map()
  return rows.reduce((result,row,index)=>{
    let key
    try {const url=new URL(row.source_url);url.hash='';key=url.href}catch{key=`invalid:${index}`}
    const existing=pages.get(key)
    if(!existing) {
      const page={...row}
      pages.set(key,{page,anchors:new Set(row.anchor?[String(row.anchor)]:[])})
      result.push(page)
    } else {
      if(row.anchor)existing.anchors.add(String(row.anchor))
      existing.page.anchor=[...existing.anchors].join(' · ')
      if(Number.isFinite(row.first_seen)&&(!Number.isFinite(existing.page.first_seen)||row.first_seen<existing.page.first_seen))existing.page.first_seen=row.first_seen
    }
    return result
  },[])
}
