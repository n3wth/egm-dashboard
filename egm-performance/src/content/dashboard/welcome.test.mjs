import test from 'node:test'
import assert from 'node:assert/strict'
import {welcomeKey,welcomeDismissed,dismissWelcome} from './welcome.mjs'
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))}}
test('the welcome card shows until it is dismissed',()=>{
  const storage=memory()
  assert.equal(welcomeDismissed(storage),false)
  dismissWelcome(storage)
  assert.equal(storage.getItem(welcomeKey),'1')
  assert.equal(welcomeDismissed(storage),true)
})
test('missing or failing storage never throws',()=>{
  const broken={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}}
  assert.equal(welcomeDismissed(broken),false)
  assert.doesNotThrow(()=>dismissWelcome(broken))
  assert.equal(welcomeDismissed(undefined),false)
  assert.doesNotThrow(()=>dismissWelcome(undefined))
})
