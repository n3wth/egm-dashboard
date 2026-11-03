import React,{useState} from 'react'

export function VideoThumbnail({id, sizes, alt = '', poster = 'hqdefault'}) {
  const [loaded,setLoaded]=useState(false)
  const [failed,setFailed]=useState(false)
  const original=`https://i.ytimg.com/vi/${encodeURIComponent(id)}/${poster}.jpg`
  if(failed)return <span className="egm-thumb-missing" role="img" aria-label="Video preview unavailable">Preview unavailable</span>
  const inspect=image=>{
    if(!image?.complete||!image.naturalWidth)return
    // YouTube serves a 120px placeholder for missing hqdefault/mqdefault images.
    if(image.naturalWidth<=120)setFailed(true)
    else setLoaded(true)
  }
  return <img className="egm-thumb" data-loaded={loaded||undefined} ref={element=>{if(!loaded)inspect(element)}} onLoad={event=>inspect(event.currentTarget)} src={original} sizes={sizes} loading="lazy" decoding="async" alt={alt} width="480" height="360" onError={()=>setFailed(true)}/>
}
