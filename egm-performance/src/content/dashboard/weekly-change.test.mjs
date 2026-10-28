import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyChange} from './weekly-change.mjs'
const days=Array.from({length:14},(_,index)=>({date:new Date(Date.UTC(2026,9,13+index)).toISOString().slice(0,10),views:index<7?10:20,clones:5,visitors:3}))
test('compares additive counts across two complete consecutive weeks',()=>{assert.equal(weeklyChange(days,'views').change,100);assert.equal(weeklyChange(days,'clones').change,0)})
test('never calculates weekly unique visitors from daily uniques',()=>{assert.equal(weeklyChange(days,'visitors'),null);assert.equal(weeklyChange(days,'cloners'),null)})
test('missing days, counts and zero baseline do not become a growth number',()=>{assert.equal(weeklyChange(days.slice(1),'views'),null);assert.equal(weeklyChange(days.map((row,i)=>i===4?{...row,views:null}:row),'views'),null);assert.equal(weeklyChange(days.map(row=>({...row,views:0})),'views'),null)})
