import test from 'node:test'
import assert from 'node:assert/strict'
import {siteMeta} from './site-meta.mjs'
import {renderAccessPage} from './auth-pages.mjs'

test('site meta has description, Open Graph and Twitter tags with an absolute image',()=>{
  const html=siteMeta('https://egm.example')
  for(const key of ['description','og:title','og:description','og:image','twitter:card','twitter:image'])assert.match(html,new RegExp(`(name|property)="${key}"`))
  assert.match(html,/og:image" content="https:\/\/egm\.example\/og\.png"/)
  assert.match(html,/twitter:card" content="summary_large_image"/)
  assert.match(html,/<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/)
})
test('site meta escapes values',()=>{
  assert.doesNotMatch(siteMeta('https://x','a"><script>'),/<script>/)
})
test('sign-in page carries social meta',async()=>{
  const html=await renderAccessPage('signin').text()
  assert.match(html,/og:image/)
})
