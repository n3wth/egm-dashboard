import test from 'node:test'
import assert from 'node:assert/strict'
import {mergePreviewQueries} from '../scripts/refresh-preview.mjs'

test('GitHub-only preview refresh preserves collected providers, performance and saved analysis',()=>{
  const previous={reach:{rows:[{stars:1}]},youtube_videos:{rows:[{views:192000}]},web_pagespeed:{rows:[{score:99}]},daily_analysis:{rows:[{headline:'Saved interpretation'}]}}
  const before=structuredClone(previous)
  const next=mergePreviewQueries(previous,{reach:{rows:[{stars:2}]},youtube_videos:{rows:[]},web_pagespeed:{rows:[]}})
  assert.equal(next.reach.rows[0].stars,2)
  for(const id of ['youtube_videos','web_pagespeed','daily_analysis'])assert.deepEqual(next[id],previous[id])
  assert.deepEqual(previous,before)
})
