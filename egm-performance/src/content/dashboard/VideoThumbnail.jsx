import React,{useState} from 'react'

export function VideoThumbnail({id, sizes}) {
  const [loaded,setLoaded]=useState(false)
  const original=`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
  const transformed=width=>`/cdn-cgi/image/width=${width},quality=80,format=auto/${original}`
  return <img className="egm-thumb" data-loaded={loaded||undefined} ref={element=>{if(element?.complete&&element.naturalWidth&&!loaded)setLoaded(true)}} onLoad={()=>setLoaded(true)} src={transformed(320)} srcSet={[160,320,480].map(width=>`${transformed(width)} ${width}w`).join(', ')} sizes={sizes} loading="lazy" decoding="async" alt="" width="480" height="360" onError={event=>{const image=event.currentTarget; if(image.getAttribute('src')!==original){image.removeAttribute('srcset'); image.src=original}}}/>
}
