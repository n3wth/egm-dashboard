import React from 'react'
import {useDataApp} from '../../data-app-public.jsx'
import {isPlainClick,pagePath} from './pages.mjs'

// The Worker serves the app uncached, so a full navigation re-downloads it; switch tabs in place instead.
export function PageLink({page,className,children,...props}) {
  const {exploreDashboard}=useDataApp()
  const onClick=event=>{
    if(!exploreDashboard||!isPlainClick(event))return
    event.preventDefault()
    exploreDashboard(page)
  }
  return <a {...props} className={className} href={pagePath(page)} onClick={onClick}>{children}</a>
}
