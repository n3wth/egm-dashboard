import test from 'node:test'
import assert from 'node:assert/strict'
import {videoCoverage} from './video-coverage.mjs'

test('discovery counts include unmeasured videos across providers without double counting URL variants',()=>{
  const result=videoCoverage({youtube_videos:{rows:[{videoId:'abcdefghijk',views:10}]},mentions:{rows:[{url:'https://youtu.be/abcdefghijk'},{url:'https://youtube.com/watch?v=lmnopqrstuv'}]},exa_mentions:{rows:[{url:'https://youtube.com/shorts/lmnopqrstuv'},{url:'https://youtube.com/watch?v=12345678901'}]}})
  assert.equal(result.discovered,3)
  assert.deepEqual(result.queryIds,['youtube_videos','mentions','exa_mentions'])
})
