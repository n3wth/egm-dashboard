import test from 'node:test'
import assert from 'node:assert/strict'
import {AccessLive,accessChanged} from './access-live.mjs'

test('invalidation reaches connected admins without exposing request data',async()=>{
  const messages=[]
  const live=new AccessLive({getWebSockets:()=>[{send:value=>messages.push(value)},{send(){throw Error('closed')}}]})
  await accessChanged({ACCESS_LIVE:{getByName:name=>{assert.equal(name,'dashboard');return {fetch:(url,init)=>live.fetch(new Request(url,init))}}}})
  assert.deepEqual(messages,['changed'])
})
