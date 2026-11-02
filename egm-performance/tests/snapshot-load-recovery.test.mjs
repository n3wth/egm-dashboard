import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

test('snapshot failure offers explicit retry and reload without exposing provider errors', async () => {
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {DataAppLoadError}=await server.ssrLoadModule('/src/DataAppRuntime.jsx')
    const html=renderToStaticMarkup(React.createElement(DataAppLoadError,{onRetry:()=>{},error:new Error('sensitive provider response')}))
    assert.match(html,/role="alert"/)
    assert.match(html,/Couldn’t load the dashboard/)
    assert.match(html,/>Try again<\/button>/)
    assert.match(html,/>Reload page<\/button>/)
    assert.doesNotMatch(html,/sensitive provider response/)
  } finally {await server.close()}
})
