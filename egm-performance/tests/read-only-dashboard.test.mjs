import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

test('owners receive read-only component capabilities while Ask and refresh remain available', async () => {
  const server = await createServer({server: {middlewareMode: true}, logLevel: 'silent'})
  try {
    const {DataAppShell} = await server.ssrLoadModule('/src/DataAppShell.jsx')
    const {useDataAppShell} = await server.ssrLoadModule('/src/DataAppContext.jsx')
    const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
    let capabilities
    function Probe() {
      const shell = useDataAppShell()
      capabilities = {canEdit: shell.canEdit, mode: shell.mode, componentCanEdit: shell.componentActions.canEdit}
      return null
    }
    const html = renderToStaticMarkup(React.createElement(DataAppShell, {snapshot, hosted: false, persistLocally: false, canEdit: true}, React.createElement(Probe)))
    assert.deepEqual(capabilities, {canEdit: false, mode: 'view', componentCanEdit: false})
    assert.match(html, /aria-label="Ask Gemini"/)
    assert.match(html, /<option value="refresh">Refresh now<\/option>/)
    assert.doesNotMatch(html, /<option value="edit">/)
    assert.doesNotMatch(html, /class="dashboard-publish-button"|contenteditable="true"/)
  } finally { await server.close() }
})
