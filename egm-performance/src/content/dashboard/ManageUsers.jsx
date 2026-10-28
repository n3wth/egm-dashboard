import React,{useEffect,useRef,useState} from 'react'
import {Button,Dialog} from '../../data-app-public.jsx'
import './manage-users.css'

export function ManageUsers({open,onClose}) {
  const [record,setRecord]=useState(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [copied,setCopied]=useState(false)
  const active=useRef(null)
  async function load(signal) {
    const response=await fetch('/api/access',{credentials:'same-origin',signal})
    if(!response.ok)throw Error(response.status===403?'Only the dashboard owner can manage access.':'Could not load users.')
    const data=await response.json()
    if(!signal.aborted)setRecord(data)
  }
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController();active.current=controller
    setRecord(null);setError('');setCopied(false)
    load(controller.signal).catch(failure=>{if(!controller.signal.aborted)setError(failure.message)})
    return ()=>controller.abort()
  },[open])
  async function decide(id,decision) {
    if(busy)return
    setBusy(true);setError('')
    try {
      const signal=active.current.signal
      const response=await fetch('/api/access',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id,decision}),signal})
      if(!response.ok)throw Error(response.status===409?'This request was already decided. Refresh the list.':'Could not update access.')
      await load(signal)
    }catch(failure){if(!active.current.signal.aborted)setError(failure.message)}finally{setBusy(false)}
  }
  return <Dialog open={open} onClose={onClose} title="Manage users" className="egm-manage-users">
    {error&&<p role="alert">{error}</p>}
    {!record&&!error&&<p role="status">Loading users…</p>}
    {record&&<><div className="egm-invite-row"><div><h3>Invite someone</h3><p>Share the sign-in link. You approve access after they sign in.</p></div><Button onClick={async()=>{try{await navigator.clipboard.writeText(record.shareUrl);setCopied(true)}catch{setError('Could not copy the link.')}}}>{copied?'Copied':'Copy invite link'}</Button></div>
    <p className="egm-access-status" role="status">{record.users.filter(user=>user.status==='pending').length} pending requests</p>
    <ul>{record.users.map(user=><li key={user.id}><div><strong>{user.name||user.email}</strong>{user.name&&<span>{user.email}</span>}<span>{user.id===record.ownerId?'Owner':user.status}</span></div>{user.status==='pending'&&user.id!==record.ownerId&&<div className="egm-access-actions"><Button disabled={busy} onClick={()=>decide(user.id,'approved')}>Approve</Button><Button variant="secondary" disabled={busy} onClick={()=>decide(user.id,'denied')}>Deny</Button></div>}</li>)}</ul></>}
  </Dialog>
}
