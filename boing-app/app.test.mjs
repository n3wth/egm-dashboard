import assert from 'node:assert/strict'
import { test } from 'node:test'

class Element {
  constructor(id = '') {
    this.id = id
    this.children = []
    this.listeners = {}
    this.attributes = {}
    this.hidden = false
    this.disabled = false
    this.textContent = ''
    this._value = ''
  }
  set value(value) { this._value = value }
  get value() { return this._value || (this.id === 'workspace-select' ? this.children[0]?.value : '') || '' }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  addEventListener(type, handler) { this.listeners[type] = handler }
  setAttribute(name, value) { this.attributes[name] = value }
  removeAttribute(name) { delete this.attributes[name] }
  click() { this.clicked = true }
  remove() {}
}

const tick = () => new Promise(resolve => setImmediate(resolve))
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

test('AI requires disclosure acknowledgement and scopes insights to the selected project', async () => {
  const ids = ['project-list', 'projects-status', 'retry-projects', 'project-empty', 'project-detail', 'detail-status', 'metrics', 'workspace-select', 'workspace-status', 'retry-workspaces', 'organization', 'project-title', 'project-meta', 'presentation-status', 'presentation-settings', 'presentation-form', 'presentation-title', 'presentation-description', 'presentation-save', 'refresh', 'export-project', 'export-status', 'website-settings', 'website-form', 'website-url', 'website-save', 'website-status', 'invitation-form', 'invitation-token', 'invitation-submit', 'invitation-status', 'create-project-section', 'create-project-form', 'create-project-name', 'create-project-submit', 'create-project-status']
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]))
  const previous = { document: globalThis.document, fetch: globalThis.fetch }
  const requests = [], disclosureId = 'a'.repeat(64)
  let enabled = false
  try {
    globalThis.document = { getElementById: id => elements[id], createElement: () => new Element(), body: { append() {} } }
    globalThis.fetch = async (path, options) => {
      requests.push({ path, options })
      if (path === '/api/boing/organizations') return json({ organizations: [{ id: 'org-a', name: 'A', role: 'owner' }] })
      if (path === '/api/boing/projects') return json({ projects: [{ id: 'p1', name: 'First' }] })
      if (path === '/api/boing/ai-settings' && options.method === 'GET') return json({ enabled, available: true, disclosure: { id: disclosureId, text: 'Data is sent to the configured processor.' } })
      if (path === '/api/boing/ai-settings' && options.method === 'PUT') { enabled = JSON.parse(options.body).enabled; return json({ enabled }) }
      if (path === '/api/boing/insights') return json({ projectId: 'p1', insight: 'Stars increased.', snapshotAt: '2026-01-01T00:00:00Z' })
      if (path === '/api/boing/members') return json({ members: [] })
      if (path.endsWith('/access')) return json({ userIds: [] })
      if (path.endsWith('/sources')) return json({ sources: [] })
      return new Response('', { status: 404 })
    }
    await import('./app.mjs?ai-consent')
    const ai = elements['project-detail'].children[2]
    for (let n = 0; n < 20 && !ai.children[4].textContent; n++) await tick()
    assert.equal(ai.children[1].textContent, 'Data is sent to the configured processor.')
    assert.equal(ai.children[5].hidden, true)
    await ai.children[4].onclick()
    assert.match(ai.children[2].textContent, /acknowledge/)
    assert.equal(requests.filter(item => item.path === '/api/boing/ai-settings' && item.options.method === 'PUT').length, 0)
    ai.children[3].children[0].checked = true
    await ai.children[4].onclick()
    const save = requests.find(item => item.path === '/api/boing/ai-settings' && item.options.method === 'PUT')
    assert.equal(save.options.headers['x-boing-organization'], 'org-a')
    assert.deepEqual(JSON.parse(save.options.body), { enabled: true, disclosureId })
    assert.equal(ai.children[5].hidden, false)
    await ai.children[5].onsubmit({ preventDefault() {} })
    const insight = requests.find(item => item.path === '/api/boing/insights')
    assert.deepEqual(JSON.parse(insight.options.body), { projectId: 'p1', focus: '' })
    assert.equal(insight.options.headers['x-boing-organization'], 'org-a')
    assert.equal(ai.children[5].children[3].textContent, 'Stars increased.')
    assert.match(ai.children[5].children[4].textContent, /stored snapshot.*check the underlying data/i)
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch }
})

test('workspace switch scopes requests and discards a delayed previous snapshot', async () => {
  const ids = ['project-list', 'projects-status', 'retry-projects', 'project-empty', 'project-detail', 'detail-status', 'metrics', 'workspace-select', 'workspace-status', 'retry-workspaces', 'organization', 'project-title', 'project-meta', 'presentation-status', 'presentation-settings', 'presentation-form', 'presentation-title', 'presentation-description', 'presentation-save', 'refresh', 'export-project', 'export-status', 'website-settings', 'website-form', 'website-url', 'website-save', 'website-status', 'invitation-form', 'invitation-token', 'invitation-submit', 'invitation-status', 'create-project-section', 'create-project-form', 'create-project-name', 'create-project-submit', 'create-project-status']
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const previousCreateObjectURL = URL.createObjectURL
  const previousRevokeObjectURL = URL.revokeObjectURL
  const requests = []
  const downloads = []
  let exportStatus = 200
  let presentationConflict = false
  let finishOldSnapshot
  let finishRename, delayRename = false
  let finishCollection
  try {
    globalThis.document = { getElementById: id => elements[id], createElement: () => new Element(), body: { append: node => downloads.push(node) } }
    URL.createObjectURL = () => 'blob:export'
    URL.revokeObjectURL = () => {}
    globalThis.fetch = async (path, options) => {
      const organizationId = options.headers['x-boing-organization']
      requests.push({ path, organizationId, signal: options.signal, method: options.method, body: options.body })
      if (path === '/api/boing/organizations') return json({ organizations: [{ id: 'org-a', name: 'A', role: 'member' }, { id: 'org-b', name: 'B', role: 'owner' }] })
      if (path === '/api/boing/members') return json({ members: [{ user_id: 'user_Member', email: 'member@example.com', role: 'member' }] })
      if (path === '/api/boing/github/install') return new Response('', { status: 503 })
      if (path.endsWith('/access')) return options.method === 'PUT' ? json({ updated: true }) : json({ userIds: [] })
      if (path === '/api/boing/invitations/accept') return json({ organizationId: 'org-b' })
      if (path === '/api/boing/projects' && options.method === 'POST') return json({ project: { id: 'new-project', name: JSON.parse(options.body).name } })
      if (path === '/api/boing/projects') return json({ projects: [{ id: `project-${organizationId}`, name: organizationId }] })
      if (path.endsWith('/name')) return delayRename ? new Promise(resolve => { finishRename = resolve }) : json({ project: { id: 'project-org-b', name: JSON.parse(options.body).name } })
      if (path.endsWith('/collect')) return new Promise(resolve => { finishCollection = resolve })
      if (path.endsWith('/presentation')) {
        if (organizationId !== 'org-b') return new Response('', { status: 404 })
        if (options.method === 'PUT') return presentationConflict ? new Response('', { status: 409 }) : json({ presentation: JSON.parse(options.body).presentation, revision: 8, canEdit: true })
        return json({ presentation: { title: 'Original', theme: 'dark' }, revision: 7, canEdit: true })
      }
      if (path.endsWith('/export')) return exportStatus === 200 ? json({ project: { id: 'project-org-b' }, snapshot: null, presentation: null }) : new Response('', { status: exportStatus })
      if (path.endsWith('/website')) return json({ updated: true })
      if (path.endsWith('/sources')) return json({ sources: [
        { kind: 'github', collectionConfigured: true, available: true, generatedAt: '2026-01-01T00:00:00Z', data: { metrics: { stars: 0, forks: 4 }, traffic: { views: { status: 'available', count: 8 } } }, lastCollection: { status: 'failed' }, error: 'collection_failed' },
        { kind: 'website', available: true, generatedAt: '2026-01-01T00:00:00Z', data: { status: 'available', performanceScore: 0 } },
      ] })
      if (path === '/api/boing/projects/project-org-a/snapshot') return new Promise(resolve => { finishOldSnapshot = resolve })
      if (path === '/api/boing/projects/project-org-b/snapshot') return json({ snapshot: { metrics: { stars: 0, forks: 4 }, traffic: { views: { status: 'available', count: 8 } } }, generatedAt: '2026-01-01T00:00:00Z' })
      throw new Error(`unexpected request ${path}`)
    }
    await import('./app.mjs')
    for (let n = 0; n < 10 && !finishOldSnapshot; n++) await tick()
    assert.ok(finishOldSnapshot, 'first project was requested')
    const github = elements['project-detail'].children[1]
    const rename = elements['project-detail'].children[3]
    const collection = elements['project-detail'].children[4]
    assert.equal(rename.hidden, true, 'members cannot rename projects')
    assert.equal(collection.hidden, true, 'members cannot request collection')
    assert.equal(github.hidden, true, 'members cannot start a GitHub connection')
    elements['workspace-select'].value = 'org-b'
    elements['workspace-select'].listeners.change()
    for (let n = 0; n < 10 && elements.metrics.children.length === 0; n++) await tick()
    assert.equal(elements['project-title'].textContent, 'org-b')
    assert.equal(elements['create-project-section'].hidden, false)
    assert.equal(github.hidden, false)
    assert.equal(rename.hidden, false)
    assert.equal(collection.hidden, false)
    assert.equal(collection.children[2].disabled, false)
    const pendingCollection = collection.children[2].listeners.click()
    for (let n = 0; n < 10 && !finishCollection; n++) await tick()
    assert.equal(requests.find(request => request.path.endsWith('/collect')).organizationId, 'org-b')
    finishCollection(json({ status: 'queued' }))
    await pendingCollection
    assert.match(collection.children[3].textContent, /Collection requested/)
    const renameForm = rename.children[1]
    renameForm.children[1].value = 'Renamed project'
    await renameForm.listeners.submit({ preventDefault() {} })
    assert.equal(elements['project-title'].textContent, 'Renamed project')
    assert.equal(elements['project-list'].children[0].children[0].textContent, 'Renamed project')
    assert.equal(requests.find(request => request.path.endsWith('/name')).organizationId, 'org-b')
    await github.children[2].listeners.click()
    assert.match(github.children[3].textContent, /not configured/)
    assert.equal(requests.find(request => request.path === '/api/boing/github/install').organizationId, 'org-b')
    const access = elements['project-detail'].children[0]
    for (let n = 0; n < 10 && !access.children[3].children.length; n++) await tick()
    assert.equal(access.hidden, false)
    const memberRow = access.children[3].children[0]
    assert.equal(memberRow.children[0].textContent, 'member@example.com')
    await memberRow.children[1].listeners.click()
    assert.equal(memberRow.children[1].textContent, 'Remove access')
    const accessUpdate = requests.find(request => request.path.endsWith('/access') && request.method === 'PUT')
    assert.equal(accessUpdate.organizationId, 'org-b')
    assert.deepEqual(JSON.parse(accessUpdate.body), { userId: 'user_Member', enabled: true })
    elements['create-project-name'].value = 'New project'
    await elements['create-project-form'].listeners.submit({ preventDefault() {} })
    assert.equal(requests.find(request => request.path === '/api/boing/projects' && request.method === 'POST').organizationId, 'org-b')
    for (let n = 0; n < 10 && elements.metrics.children.length === 0; n++) await tick()
    assert.deepEqual(elements.metrics.children.map(card => card.children[1].textContent), ['0', '4', '8', 'Unavailable', 'Unavailable'])
    await elements['export-project'].listeners.click()
    assert.equal(downloads.length, 1)
    assert.equal(downloads[0].download, 'boing-project-export.json')
    assert.equal(downloads[0].clicked, true)
    assert.match(elements['export-status'].textContent, /download is ready/)
    exportStatus = 403
    await elements['export-project'].listeners.click()
    assert.match(elements['export-status'].textContent, /no longer have access/)
    assert.equal(requests.find(request => request.path.endsWith('/export')).organizationId, 'org-b')
    assert.equal(elements['export-project'].disabled, false)
    assert.equal(elements['website-settings'].hidden, false)
    elements['website-url'].value = 'https://example.com'
    await elements['website-form'].listeners.submit({ preventDefault() {} })
    const update = requests.find(request => request.path.endsWith('/website'))
    assert.equal(update.method, 'PUT')
    assert.equal(update.organizationId, 'org-b')
    assert.deepEqual(JSON.parse(update.body), { website: 'https://example.com' })
    assert.match(elements['website-status'].textContent, /Website saved/)
    assert.equal(elements['presentation-settings'].hidden, false)
    elements['presentation-title'].value = 'New title'
    elements['presentation-description'].value = 'Description'
    await elements['presentation-form'].listeners.submit({ preventDefault() {} })
    const presentationUpdate = requests.find(request => request.path.endsWith('/presentation') && request.method === 'PUT')
    assert.equal(presentationUpdate.organizationId, 'org-b')
    assert.deepEqual(JSON.parse(presentationUpdate.body), { revision: 7, presentation: { title: 'New title', description: 'Description', theme: 'dark' } })
    assert.match(elements['presentation-status'].textContent, /saved/)
    presentationConflict = true
    await elements['presentation-form'].listeners.submit({ preventDefault() {} })
    assert.match(elements['presentation-status'].textContent, /changed elsewhere/)
    assert.equal(elements['presentation-save'].disabled, true)
    assert.match(elements['detail-status'].textContent, /Latest collection failed/)
    assert.ok(requests.filter(request => request.path.startsWith('/api/boing/projects')).every(request => request.organizationId === 'org-a' || request.organizationId === 'org-b'))
    assert.ok(requests.filter(request => request.path.includes('/project-org-a/')).every(request => request.organizationId === 'org-a'))
    assert.ok(requests.filter(request => request.path.includes('/project-org-b/')).every(request => request.organizationId === 'org-b'))
    assert.equal(requests.find(request => request.path.endsWith('project-org-a/snapshot')).signal.aborted, true)
    finishOldSnapshot(json({ snapshot: { metrics: { stars: 999 } } }))
    await tick()
    assert.equal(elements['project-title'].textContent, 'org-b')
    assert.deepEqual(elements.metrics.children.map(card => card.children[1].textContent), ['0', '4', '8', 'Unavailable', 'Unavailable', '0'])
    elements['invitation-token'].value = 'a'.repeat(43)
    await elements['invitation-form'].listeners.submit({ preventDefault() {} })
    const invite = requests.find(request => request.path === '/api/boing/invitations/accept')
    assert.equal(invite.method, 'POST')
    assert.equal(invite.organizationId, undefined)
    assert.equal(elements['invitation-token'].value, '')
    assert.match(elements['invitation-status'].textContent, /accepted/)
    for (let n = 0; n < 10 && rename.hidden; n++) await tick()
    delayRename = true
    renameForm.children[1].value = 'Delayed name'
    const pendingRename = renameForm.listeners.submit({ preventDefault() {} })
    finishCollection = undefined
    const delayedCollection = collection.children[2].listeners.click()
    for (let n = 0; n < 10 && !finishRename; n++) await tick()
    assert.ok(finishRename)
    assert.ok(finishCollection)
    elements['workspace-select'].value = 'org-a'
    elements['workspace-select'].listeners.change()
    for (let n = 0; n < 10 && elements['project-title'].textContent !== 'org-a'; n++) await tick()
    finishRename(json({ project: { id: 'project-org-b', name: 'Delayed name' } }))
    finishCollection(json({ status: 'queued' }))
    await pendingRename
    await delayedCollection
    assert.equal(elements['project-title'].textContent, 'org-a')
    assert.equal(rename.hidden, true)
    assert.equal(collection.hidden, true)
    assert.equal(collection.children[3].textContent, '')
  } finally {
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
    URL.createObjectURL = previousCreateObjectURL
    URL.revokeObjectURL = previousRevokeObjectURL
  }
})

test('resumes repository selection for the original project and workspace after GitHub', async () => {
  const ids = ['project-list', 'projects-status', 'retry-projects', 'project-empty', 'project-detail', 'detail-status', 'metrics', 'workspace-select', 'workspace-status', 'retry-workspaces', 'organization', 'project-title', 'project-meta', 'presentation-status', 'presentation-settings', 'presentation-form', 'presentation-title', 'presentation-description', 'presentation-save', 'refresh', 'export-project', 'export-status', 'website-settings', 'website-form', 'website-url', 'website-save', 'website-status', 'invitation-form', 'invitation-token', 'invitation-submit', 'invitation-status', 'create-project-section', 'create-project-form', 'create-project-name', 'create-project-submit', 'create-project-status']
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]))
  const previous = { document: globalThis.document, fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage }
  let pending = JSON.stringify({ organizationId: 'org-b', projectId: 'p2' }), selection
  try {
    globalThis.document = { getElementById: id => elements[id], createElement: () => new Element(), body: { append() {} } }
    globalThis.sessionStorage = { getItem: () => pending, setItem: (_, value) => { pending = value }, removeItem: () => { pending = null } }
    globalThis.fetch = async (path, options) => {
      if (path === '/api/boing/organizations') return json({ organizations: [{ id: 'org-a', name: 'A', role: 'owner' }, { id: 'org-b', name: 'B', role: 'owner' }] })
      if (path === '/api/boing/projects') return json({ projects: [{ id: 'p1', name: 'First' }, { id: 'p2', name: 'Second' }] })
      if (path === '/api/boing/github/repositories') return json({ projectId: 'p2', repositories: [{ id: 42, fullName: 'team/repo', private: true }] })
      if (path === '/api/boing/github/select') { selection = { org: options.headers['x-boing-organization'], body: JSON.parse(options.body) }; return json({ connected: true }) }
      if (path === '/api/boing/members') return json({ members: [] })
      if (path.endsWith('/access')) return json({ userIds: [] })
      if (path.endsWith('/sources')) return json({ sources: [] })
      return new Response('', { status: 404 })
    }
    await import('./app.mjs?github-resume')
    const github = elements['project-detail'].children[1]
    for (let n = 0; n < 20 && github.children[4].hidden; n++) await tick()
    assert.equal(elements['workspace-select'].value, 'org-b')
    assert.equal(elements['project-title'].textContent, 'Second')
    const form = github.children[4], select = form.children[1]
    assert.equal(form.hidden, false)
    assert.equal(select.children[0].textContent, 'team/repo (private)')
    select.value = '42'
    await form.listeners.submit({ preventDefault() {} })
    assert.deepEqual(selection, { org: 'org-b', body: { repositoryId: 42 } })
    assert.equal(pending, null)
    for (let n = 0; n < 10; n++) await tick()
  } finally {
    globalThis.document = previous.document
    globalThis.fetch = previous.fetch
    globalThis.sessionStorage = previous.sessionStorage
  }
})
