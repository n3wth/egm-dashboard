import test from 'node:test'
import assert from 'node:assert/strict'
import {pages,pagePath,adjacentPages,isPlainClick} from './pages.mjs'
test('every page has a canonical path matching the dashboard routes',()=>{
  assert.deepEqual(pages.map(page=>page.path),['/overview','/acquisition','/adoption','/website','/development','/research','/mentions'])
  assert.equal(pagePath('reach'),'/overview')
  assert.equal(pagePath('mentions'),'/mentions')
  assert.equal(pagePath('missing'),null)
})
test('adjacent pages follow the tab order and stop at the ends',()=>{
  assert.deepEqual(adjacentPages('reach'),{previous:null,next:pages[1]})
  assert.equal(adjacentPages('website').previous.id,'adoption')
  assert.equal(adjacentPages('website').next.id,'development')
  assert.deepEqual(adjacentPages('mentions'),{previous:pages[5],next:null})
  assert.deepEqual(adjacentPages('missing'),{previous:null,next:null})
})
test('only plain primary clicks are handled in place',()=>{
  const click={defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false}
  assert.equal(isPlainClick(click),true)
  assert.equal(isPlainClick({...click,metaKey:true}),false)
  assert.equal(isPlainClick({...click,ctrlKey:true}),false)
  assert.equal(isPlainClick({...click,shiftKey:true}),false)
  assert.equal(isPlainClick({...click,button:1}),false)
  assert.equal(isPlainClick({...click,defaultPrevented:true}),false)
})
