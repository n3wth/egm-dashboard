import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptInvitation, ApiError, collectProject, createProject, listGithubRepositories, metricCards, metricsFromSnapshot, readJson, renameProject, selectGithubRepository, snapshotFreshness, sourceStatus, startGithubInstall, updatePresentation, updateWebsite, websiteMetric } from './api.mjs'

test('requests collection for the selected project and workspace without a request body', async () => {
  let sent
  await collectProject('p1', { organizationId: 'org-1', request: async (path, options) => { sent = { path, options }; return Response.json({ status: 'queued' }, { status: 202 }) } })
  assert.equal(sent.path, '/api/boing/projects/p1/collect')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.equal(sent.options.body, undefined)
  await assert.rejects(collectProject('p1', { organizationId: 'org-1', request: async () => new Response('', { status: 503 }) }), error => error instanceof ApiError && error.status === 503)
})

test('renames only the selected project in the selected workspace', async () => {
  let sent
  const result = await renameProject('p1', ' New name ', { organizationId: 'org-1', request: async (path, options) => { sent = { path, options }; return Response.json({ project: { id: 'p1', name: 'New name' } }) } })
  assert.deepEqual(result, { id: 'p1', name: 'New name' })
  assert.equal(sent.path, '/api/boing/projects/p1/name')
  assert.equal(sent.options.method, 'PUT')
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.deepEqual(JSON.parse(sent.options.body), { name: 'New name' })
  await assert.rejects(renameProject('p1', 'New', { organizationId: 'org-1', request: async () => Response.json({ project: { id: 'other', name: 'New' } }) }))
})

test('GitHub setup sends scoped project and only follows GitHub App installation URLs', async () => {
  let sent
  const request = async (path, options) => { sent = { path, options }; return Response.json({ url: 'https://github.com/apps/boing-test/installations/new?state=safe' }) }
  assert.equal(await startGithubInstall('project-1', { organizationId: 'org-1', request }), 'https://github.com/apps/boing-test/installations/new?state=safe')
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.deepEqual(JSON.parse(sent.options.body), { projectId: 'project-1' })
  await assert.rejects(startGithubInstall('project-1', { organizationId: 'org-1', request: async () => Response.json({ url: 'https://github.com.evil.test/apps/boing/installations/new' }) }))
})

test('GitHub repository selection requires the same project and filters unsafe provider data', async () => {
  const request = async () => Response.json({ projectId: 'p1', repositories: [{ id: 42, fullName: 'team/repo', private: true }, { id: 43, fullName: '<script>', private: false }] })
  assert.deepEqual(await listGithubRepositories('p1', { organizationId: 'org-1', request }), [{ id: 42, fullName: 'team/repo', private: true }])
  await assert.rejects(listGithubRepositories('p2', { organizationId: 'org-1', request }))
  let sent
  await selectGithubRepository(42, { organizationId: 'org-1', request: async (path, options) => { sent = { path, options }; return Response.json({ connected: true }) } })
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.deepEqual(JSON.parse(sent.options.body), { repositoryId: 42 })
})

test('requests authenticated, uncached same-origin data', async () => {
  let input
  const result = await readJson('/api/boing/projects', { request: async (...args) => { input = args; return new Response('{"projects":[]}', { status: 200 }) } })
  assert.deepEqual(result, { projects: [] })
  assert.equal(input[0], '/api/boing/projects')
  assert.equal(input[1].credentials, 'same-origin')
  assert.equal(input[1].cache, 'no-store')
})

test('sends the selected workspace for project requests', async () => {
  let headers
  await readJson('/api/boing/projects', { organizationId: 'org-local-1', request: async (_, options) => { headers = options.headers; return new Response('{}') } })
  assert.equal(headers['x-boing-organization'], 'org-local-1')
  await assert.rejects(readJson('/api/boing/projects', { organizationId: 'bad\nheader' }), TypeError)
})

test('displays current collector metrics, preserving zero and provider unavailability', () => {
  assert.deepEqual(metricCards({ metrics: { stars: 0, forks: 9 }, traffic: { views: { status: 'unavailable', count: 12 } } }), [
    { label: 'GitHub stars', value: 0 },
    { label: 'GitHub forks', value: 9 },
    { label: 'Repository views (reporting window)', value: null },
    { label: 'Repository clones (reporting window)', value: null },
    { label: 'Open issues and pull requests', value: null },
  ])
  assert.equal(metricCards({ metrics: {}, traffic: { views: { status: 'available', count: 0 } } })[2].value, 0)
})

test('shows unavailable measurements explicitly without replacing zero', () => {
  assert.deepEqual(metricCards({ queries: { reach: { rows: [{ stars: 0 }] } } }), [
    { label: 'GitHub stars', value: 0 },
    { label: 'GitHub forks', value: null },
    { label: 'Repository views (reporting window)', value: null },
    { label: 'Repository clones (reporting window)', value: null },
    { label: 'Open issues and pull requests', value: null },
  ])
})

test('shows collected clones and open issue totals without inventing legacy values', () => {
  const cards = metricCards({ metrics: { openIssues: 7 }, traffic: { clones: { status: 'available', count: 0 } } })
  assert.equal(cards[3].value, 0)
  assert.equal(cards[4].value, 7)
  assert.equal(metricCards({ metrics: {}, traffic: { clones: { status: 'unavailable', count: 9 } } })[3].value, null)
  assert.equal(metricCards({ queries: { reach: { rows: [{ openIssues: 7, clones: 9 }] } } })[4].value, null)
})

test('reports snapshot age and does not claim an invalid or future date', () => {
  const now = Date.parse('2026-01-03T00:00:00Z')
  assert.match(snapshotFreshness('2026-01-01T00:00:00Z', now), /^Collected 48 hours ago/)
  assert.equal(snapshotFreshness('invalid', now), 'Collection time unavailable')
  assert.equal(snapshotFreshness('2026-01-04T00:00:00Z', now), 'Collection time unavailable')
})

test('reports source failures and treats missing website data distinctly from zero', () => {
  assert.match(sourceStatus({ available: false, lastCollection: { status: 'failed' } }, 'Website'), /No collected data available.*Latest collection failed/)
  const unavailable = sourceStatus({ available: false, data: null, error: 'source_unavailable', lastCollection: { status: 'succeeded' } }, 'Website')
  assert.match(unavailable, /Measurement unavailable/)
  assert.doesNotMatch(unavailable, /collection failed/)
  assert.match(sourceStatus({ available: true, generatedAt: '2020-01-01T00:00:00Z', error: 'collection_failed' }, 'GitHub'), /Collected .*Latest collection failed/)
  assert.match(sourceStatus({ available: false, collectionConfigured: false }, 'Website'), /Collection is not configured/)
  assert.doesNotMatch(sourceStatus({ available: false, collectionConfigured: true }, 'Website'), /not configured/)
  assert.equal(websiteMetric({ available: true, data: { status: 'available', performanceScore: 0 } }).value, 0)
  assert.equal(websiteMetric({ available: true, data: { status: 'unavailable', performanceScore: 70 } }).value, null)
  assert.equal(websiteMetric({ available: false }).value, null)
})

test('returns status on an unsuccessful response', async () => {
  await assert.rejects(readJson('/api/boing/projects', { request: async () => new Response('', { status: 401 }) }), error => error instanceof ApiError && error.status === 401)
})

test('only presents valid supported measurements', () => {
  assert.deepEqual(metricsFromSnapshot({ queries: { reach: { rows: [{ stars: 0, forks: 2, views: -1, privateNotes: 'hidden' }] } } }), [
    { label: 'GitHub stars', value: 0 }, { label: 'GitHub forks', value: 2 },
  ])
  assert.deepEqual(metricsFromSnapshot({ queries: {} }), [])
})

const invalidResponse = error => error.message === 'invalid_response'
const failed500 = error => error instanceof ApiError && error.status === 500

test('creates a project in the selected workspace and requires a valid project back', async () => {
  await assert.rejects(createProject('Site', { organizationId: 'bad org' }), TypeError)
  let sent
  const project = await createProject('Site', { organizationId: 'org-1', request: async (path, options) => { sent = { path, options }; return Response.json({ project: { id: 'p1', name: 'Site' } }) } })
  assert.deepEqual(project, { id: 'p1', name: 'Site' })
  assert.equal(sent.path, '/api/boing/projects')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.deepEqual(JSON.parse(sent.options.body), { name: 'Site' })
  await assert.rejects(createProject('Site', { organizationId: 'org-1', request: async () => new Response('', { status: 500 }) }), failed500)
  await assert.rejects(createProject('Site', { organizationId: 'org-1', request: async () => Response.json({}) }), invalidResponse)
})

test('updates the website of the selected project and requires confirmation', async () => {
  await assert.rejects(updateWebsite('p/1', null, { organizationId: 'org-1' }), TypeError)
  let sent
  await updateWebsite('p1', 'https://example.com', { organizationId: 'org-1', request: async (path, options) => { sent = { path, options }; return Response.json({ updated: true }) } })
  assert.equal(sent.path, '/api/boing/projects/p1/website')
  assert.equal(sent.options.method, 'PUT')
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.deepEqual(JSON.parse(sent.options.body), { website: 'https://example.com' })
  await assert.rejects(updateWebsite('p1', null, { organizationId: 'org-1', request: async () => new Response('', { status: 500 }) }), failed500)
  await assert.rejects(updateWebsite('p1', null, { organizationId: 'org-1', request: async () => Response.json({}) }), invalidResponse)
})

test('updates presentation with its revision and requires a presentation back', async () => {
  await assert.rejects(updatePresentation('p1', [], 0, { organizationId: 'org-1' }), TypeError)
  let sent
  const result = await updatePresentation('p1', { theme: 'dark' }, 3, { organizationId: 'org-1', request: async (path, options) => { sent = { path, options }; return Response.json({ presentation: { theme: 'dark' }, revision: 4 }) } })
  assert.deepEqual(result, { presentation: { theme: 'dark' }, revision: 4 })
  assert.equal(sent.path, '/api/boing/projects/p1/presentation')
  assert.equal(sent.options.method, 'PUT')
  assert.equal(sent.options.headers['x-boing-organization'], 'org-1')
  assert.deepEqual(JSON.parse(sent.options.body), { presentation: { theme: 'dark' }, revision: 3 })
  await assert.rejects(updatePresentation('p1', {}, 0, { organizationId: 'org-1', request: async () => new Response('', { status: 500 }) }), failed500)
  await assert.rejects(updatePresentation('p1', {}, 0, { organizationId: 'org-1', request: async () => Response.json({ revision: 1 }) }), invalidResponse)
})

test('accepts an invitation without a workspace header and returns the joined workspace', async () => {
  const token = 'a'.repeat(32)
  await assert.rejects(acceptInvitation('short'), TypeError)
  let sent
  assert.equal(await acceptInvitation(token, { request: async (path, options) => { sent = { path, options }; return Response.json({ organizationId: 'org-1' }) } }), 'org-1')
  assert.equal(sent.path, '/api/boing/invitations/accept')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.headers['x-boing-organization'], undefined)
  assert.deepEqual(JSON.parse(sent.options.body), { token })
  await assert.rejects(acceptInvitation(token, { request: async () => new Response('', { status: 500 }) }), failed500)
  await assert.rejects(acceptInvitation(token, { request: async () => Response.json({}) }), invalidResponse)
})
