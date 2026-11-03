import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('access actions identify the affected person and invitation', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { UserAccessActions, InvitationRevokeAction, CopyInvitationLink, UserActivity } = await server.ssrLoadModule('/src/content/dashboard/ManageUsers.jsx')
    const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
    const actions = render(UserAccessActions, {user:{id:'1',name:'Alex',email:'alex@example.com'},busy:false,onDecide:()=>{}})
    assert.match(actions, /aria-label="Approve Alex \(alex@example.com\)"/)
    assert.match(actions, /aria-label="Deny Alex \(alex@example.com\)"/)
    assert.match(render(UserAccessActions, {user:{id:'1',name:'Alex',email:'alex@example.com',status:'approved'},busy:false,onDecide:()=>{}}), /aria-label="Revoke access for Alex \(alex@example.com\)"/)
    assert.match(render(UserAccessActions, {user:{id:'1',name:'Alex',email:'alex@example.com',status:'denied'},busy:false,onDecide:()=>{}}), /aria-label="Undo denial for Alex \(alex@example.com\)"/)
    assert.match(render(InvitationRevokeAction,{invitation:{id:'2',email:'alex@example.com'},onRevoke:()=>{}}), /aria-label="Revoke invitation for alex@example.com"/)
    assert.match(render(InvitationRevokeAction,{invitation:{id:'3'},onRevoke:()=>{}}), /aria-label="Revoke shareable link invitation"/)
    assert.match(render(CopyInvitationLink,{copied:true,onCopy:()=>{}}), /role="status"[^>]*>Invitation link copied\./)
    assert.match(render(UserActivity,{status:'unavailable'}),/Usage unavailable/)
    assert.match(render(UserActivity,{status:'available',activity:null}),/No recorded activity in 30 days/)
    const activity=render(UserActivity,{status:'available',activity:{lastSeen:new Date(Date.now()-7200000).toISOString(),pageViews:12,activeDays:1,questions:1}})
    assert.match(activity,/Last visited/)
    assert.match(activity,/2 hours ago/)
    assert.match(activity,/12 page views · 1 active day · 1 Ask question/)
    assert.match(activity,/<time dateTime=/)
  } finally { await server.close() }
})
