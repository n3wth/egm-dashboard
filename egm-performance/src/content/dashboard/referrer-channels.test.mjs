import test from 'node:test'
import assert from 'node:assert/strict'
import {channelOf,channelViews,isSearchVideo} from './referrer-channels.mjs'

test('maps GitHub referrer strings to one channel name each',()=>{
  assert.equal(channelOf('com.linkedin.android'),'LinkedIn')
  assert.equal(channelOf('teams.public.onecdn.static.microsoft'),'Teams')
  assert.equal(channelOf('m.youtube.com'),'YouTube')
  for(const raw of ['t.co','x.com','twitter.com','www.twitter.com','X'])assert.equal(channelOf(raw),'X')
  assert.equal(channelOf('trendshift.io'),'Trendshift')
  assert.equal(channelOf('www.github.com'),'GitHub')
  assert.equal(channelOf('example.org'),'example.org')
  assert.equal(channelOf(undefined),'')
})
test('search and video channels are recognised regardless of spelling',()=>{
  assert.equal(isSearchVideo('Google'),true)
  assert.equal(isSearchVideo('youtube.com'),true)
  assert.equal(isSearchVideo('github.com'),false)
})
test('channel views merge variants, skip invalid counts and sort descending',()=>{
  const rows=channelViews([{referrer:'linkedin.com',count:30},{referrer:'com.linkedin.android',count:40},{referrer:'Google',count:20},{referrer:'Bing',count:null},{referrer:'Bing',count:-1}])
  assert.deepEqual(rows,[{source:'LinkedIn',count:70},{source:'Google',count:20}])
})
