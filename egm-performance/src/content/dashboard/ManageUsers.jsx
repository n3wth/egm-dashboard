import React,{useEffect,useRef,useState} from 'react'
import {Button,Dialog,Icon,Menu,MenuItem} from '../../data-app-public.jsx'
import './manage-users.css'

function UserAvatar({user}) {
  const [failed,setFailed]=useState(false)
  let photo=null
  try {const url=new URL(user.profilePictureUrl);if(url.protocol==='https:'&&url.hostname==='workoscdn.com'&&!url.username&&!url.password&&!url.port)photo=url.href}catch{}
  const initials=(user.name||user.email||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'?'
  return <span className="egm-user-avatar" aria-hidden="true">{photo&&!failed?<img src={photo} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:initials}</span>
}

export function ManageUsers({open,onClose}) {
  const [record,setRecord]=useState(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [copied,setCopied]=useState(false)
  const [email,setEmail]=useState('')
  const [expiresInDays,setExpiresInDays]=useState(7)
  const [createdLink,setCreatedLink]=useState(null)
  const [notice,setNotice]=useState('')
  const [invitations,setInvitations]=useState(null)
  const [emailAvailable,setEmailAvailable]=useState(null)
  const [inviteError,setInviteError]=useState('')
  const [dialogElement,setDialogElement]=useState(null)
  const active=useRef(null)
  async function load(signal) {
    const response=await fetch('/api/access',{credentials:'same-origin',signal})
    if(!response.ok)throw Error(response.status===403?'Only the dashboard owner can manage access.':'Could not load users.')
    const data=await response.json()
    if(!signal.aborted)setRecord(data)
  }
  async function loadInvitations(signal) {
    const response=await fetch('/api/invitations',{credentials:'same-origin',signal})
    if(!response.ok)throw Error('Invitations are unavailable. Please try again later.')
    const data=await response.json()
    if(!Array.isArray(data.invitations))throw Error('Could not load invitations.')
    if(!signal.aborted){setInvitations(data.invitations);setEmailAvailable(data.emailAvailable===true)}
  }
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController();active.current=controller
    setRecord(null);setError('');setBusy(false);setCopied(false);setCreatedLink(null);setNotice('');setInvitations(null);setEmailAvailable(null);setInviteError('');setEmail('');setExpiresInDays(7)
    load(controller.signal).catch(failure=>{if(!controller.signal.aborted)setError(failure.message)})
    loadInvitations(controller.signal).catch(failure=>{if(!controller.signal.aborted)setInviteError(failure.message)})
    return ()=>controller.abort()
  },[open])
  async function decide(id,decision) {
    if(busy)return
    const signal=active.current.signal
    setBusy(true);setError('')
    try {
      const response=await fetch('/api/access',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id,decision}),signal})
      if(!response.ok)throw Error(response.status===409?'This request was already decided. Refresh the list.':'Could not update access.')
      await load(signal)
    }catch(failure){if(!signal.aborted)setError(failure.message)}finally{if(!signal.aborted)setBusy(false)}
  }
  async function createInvitation(kind) {
    if(busy)return
    const signal=active.current.signal
    setBusy(true);setInviteError('');setNotice('')
    if(kind==='link'){setCopied(false);setCreatedLink(null)}
    try {
      const response=await fetch('/api/invitations',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({kind,expiresInDays,...(kind==='email'?{email:email.trim()}: {})}),signal})
      if(!response.ok)throw Error(response.status===400?'Check the email address and expiration.':response.status===409?'An invitation may already exist or could not be saved. Check the list before trying again.':response.status===503&&kind==='email'?'Email invitations are not configured.':'Could not create the invitation.')
      const data=await response.json()
      if(signal.aborted)return
      if(response.status===202 && kind==='email') {
        setNotice('Email delivery is unconfirmed. Check the invitation status before trying again.')
      } else if(kind==='link') {
        let url
        try {url=new URL(data.url)} catch {throw Error('The invitation link was not returned.')}
        if(url.origin!==window.location.origin||url.pathname!=='/auth/invite'||!url.searchParams.get('invitation_token'))throw Error('The invitation link was not returned.')
        setCreatedLink({id:data.id,url:url.href,expiresAt:data.expiresAt})
      } else {
        setNotice('Invitation email accepted for delivery.')
        setEmail('')
      }
      await loadInvitations(signal).catch(()=>{if(!signal.aborted)setInviteError('Invitation created, but the list could not be refreshed.')})
    } catch(failure){if(!signal.aborted)setInviteError(failure.message)}finally{if(!signal.aborted)setBusy(false)}
  }
  async function revokeInvitation(id) {
    if(busy)return
    const signal=active.current.signal
    setBusy(true);setInviteError('');setNotice('')
    try {
      const response=await fetch('/api/invitations/revoke',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id}),signal})
      if(!response.ok)throw Error('Could not revoke the invitation. Refresh and try again.')
      await loadInvitations(signal)
      if(signal.aborted)return
      if(createdLink?.id===id){setCreatedLink(null);setCopied(false)}
      setNotice('Invitation revoked.')
    }catch(failure){if(!signal.aborted)setInviteError(failure.message)}finally{if(!signal.aborted)setBusy(false)}
  }
  const date=value=>{const parsed=new Date(value);return value&&Number.isFinite(parsed.getTime())?parsed.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Unknown'}
  const pending=record?.users.filter(user=>user.status==='pending')??[]
  return <Dialog open={open} onClose={onClose} title="Manage users" className="egm-manage-users" initialFocusSelector=".dialog-header" contentRef={setDialogElement}>
    {error&&<p className="egm-manage-message" role="alert">{error}</p>}
    {!record&&!error&&<p role="status">Loading users…</p>}
    {record&&<><section className="egm-invite-panel" aria-labelledby="egm-invite-heading"><div><h3 id="egm-invite-heading">Invite someone</h3><p>Invitations grant access after sign-in and can be used once.</p></div>
      <form className="egm-invite-email" onSubmit={event=>{event.preventDefault();if(emailAvailable)createInvitation('email')}}><input aria-label="Email address" type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="Email address" autoComplete="email" required /><Button type="submit" variant="primary" disabled={busy||emailAvailable!==true||!email.trim()}>Send invite</Button></form>
      <div className="egm-invite-options"><div className="egm-expiry-control"><span>Expires</span><Menu label="Invitation expiration" align="start" portalContainer={dialogElement} trigger={<Button type="button" className="egm-expiry-trigger" aria-label={`Invitation expiration: ${expiresInDays} ${expiresInDays===1?'day':'days'}`} disabled={busy}>{expiresInDays} {expiresInDays===1?'day':'days'}<Icon name="chevronDown" size={14}/></Button>}>{[1,7,30].map(days=><MenuItem key={days} role="menuitemradio" aria-checked={days===expiresInDays} onSelect={()=>setExpiresInDays(days)}>{days} {days===1?'day':'days'}{days===expiresInDays&&<Icon name="check" size={16}/>}</MenuItem>)}</Menu></div><Button type="button" disabled={busy||!invitations} onClick={()=>createInvitation('link')}>Create link</Button></div>
      {emailAvailable===false&&<p>Email invitations are unavailable. You can share a link instead.</p>}
      {notice&&<p className="egm-manage-message" role="status">{notice}</p>}{inviteError&&<p className="egm-manage-message" role="alert">{inviteError}</p>}
      {createdLink&&<div className="egm-invite-created"><label>Invitation link<input readOnly value={createdLink.url} onFocus={event=>event.target.select()} /></label><Button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(createdLink.url);setCopied(true)}catch{setInviteError('Could not copy the link. Select it to copy manually.')}}}>{copied?'Copied':'Copy link'}</Button><p>Expires {date(createdLink.expiresAt)}. Copy it now; it cannot be shown again.</p></div>}
    </section>
    <section className="egm-manage-section" aria-labelledby="egm-users-heading"><div className="egm-manage-section-heading"><h3 id="egm-users-heading">Users</h3><span>{pending.length} pending</span></div>
    <ul aria-label="Users">{record.users.map(user=><li key={user.id}><div className="egm-user-identity"><UserAvatar user={user}/><div className="egm-user-details"><strong>{user.name||user.email}</strong>{user.name&&<span>{user.email}</span>}</div></div>{user.status==='pending'&&user.id!==record.ownerId?<div className="egm-access-actions"><Button type="button" disabled={busy} onClick={()=>decide(user.id,'approved')}>Approve</Button><Button type="button" disabled={busy} onClick={()=>decide(user.id,'denied')}>Deny</Button></div>:<span className="egm-user-status">{user.id===record.ownerId?'Owner':user.status==='approved'?'Approved':user.status==='pending'?'Pending approval':'Access denied'}</span>}</li>)}</ul></section>
    {invitations?.length>0&&<section className="egm-manage-section" aria-labelledby="egm-invitations-heading"><h3 id="egm-invitations-heading">Invitations</h3><ul aria-label="Invitations">{invitations.map(invitation=>{const expired=new Date(invitation.expiresAt).getTime()<=Date.now(),active=!invitation.redeemedAt&&!invitation.revokedAt&&!expired;const state=invitation.redeemedAt?'Used':invitation.revokedAt?'Revoked':expired?'Expired':invitation.deliveryState==='unknown'||invitation.deliveryState==='sending'?'Email delivery unconfirmed':invitation.deliveryState==='failed'?'Email delivery failed':'Active';return <li key={invitation.id}><div><strong>{invitation.email||'Shareable link'}</strong><span>{state}{active?` · Expires ${date(invitation.expiresAt)}`:''}</span></div>{active&&<Button type="button" disabled={busy} onClick={()=>revokeInvitation(invitation.id)}>Revoke</Button>}</li>})}</ul></section>}</>}
  </Dialog>
}
