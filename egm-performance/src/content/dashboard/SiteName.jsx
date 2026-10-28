import React,{useState} from 'react'
import {ProviderIcon} from './ProviderIcon.jsx'

const failedHosts=new Set()
const aliases={Google:'google.com',YouTube:'youtube.com',LinkedIn:'linkedin.com',GitHub:'github.com',Teams:'microsoft.com',Threads:'threads.com',Bing:'bing.com',DuckDuckGo:'duckduckgo.com',Exa:'exa.ai',Tavily:'tavily.com',Parallel:'parallel.ai',Firecrawl:'firecrawl.dev',Semrush:'semrush.com'}
function siteHost(url,host,label) {
  const value=host??url??aliases[label]??(typeof label==='string'&&label.includes('.')?label:null)
  if(!value)return null
  try {return new URL(value?.includes('://')?value:'https://'+value).hostname.toLowerCase()}catch{return null}
}
export function SiteName({url,host,label,children,className=''}) {
  const hostname=siteHost(url,host,label)
  const name=children??label??hostname?.replace(/^www\./,'')??''
  const [failed,setFailed]=useState(null)
  const available=hostname&&failed!==hostname&&!failedHosts.has(hostname)
  const iconStyle={width:16,height:16,flex:'0 0 16px',borderRadius:4,objectFit:'contain',verticalAlign:'middle'}
  const provider=({'exa.ai':'Exa','tavily.com':'Tavily','parallel.ai':'Parallel'})[hostname?.replace(/^www\./,'')]
  return <span className={className} style={{display:'inline-flex',alignItems:'center',gap:6,verticalAlign:'middle',minWidth:0,maxWidth:'100%'}}>
{provider?<ProviderIcon name={provider} style={{...iconStyle,width:12,height:12,flex:'0 0 12px'}}/>:available?<img src={'/api/site-icon?v=3&host='+encodeURIComponent(hostname)} alt="" width="16" height="16" loading="lazy" style={iconStyle} onError={()=>{failedHosts.add(hostname);setFailed(hostname)}}/>:<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" style={iconStyle} fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>}
    <span style={{minWidth:0,overflowWrap:'anywhere'}}>{name}</span>
  </span>
}
