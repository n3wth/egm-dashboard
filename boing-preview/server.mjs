// Local-only, fictional-data preview. This is not an authentication server.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = new Map([
  ['/', ['boing-site/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['boing-site/index.html', 'text/html; charset=utf-8']],
  ['/product.html', ['boing-site/product.html', 'text/html; charset=utf-8']],
  ['/features.html', ['boing-site/features.html', 'text/html; charset=utf-8']],
  ['/terms.html', ['boing-site/terms.html', 'text/html; charset=utf-8']],
  ['/privacy.html', ['boing-site/privacy.html', 'text/html; charset=utf-8']],
  ['/style.css', ['boing-site/style.css', 'text/css; charset=utf-8']],
  ['/motion.js', ['boing-site/motion.js', 'text/javascript; charset=utf-8']],
  ['/vendor/gsap-3.15.0.min.js', ['boing-site/vendor/gsap-3.15.0.min.js', 'text/javascript; charset=utf-8']],
  ['/logo/boing-approved.png', ['boing-site/logo/boing-approved.png', 'image/png']],
  ['/logo/favicon.svg', ['boing-site/logo/favicon.svg', 'image/svg+xml']],
  ['/rive/motion.js', ['boing-site/rive/motion.js', 'text/javascript; charset=utf-8']],
  ['/rive/momentum.svg', ['boing-site/rive/momentum.svg', 'image/svg+xml']],
  ['/rive/momentum.riv', ['boing-site/rive/momentum.riv', 'application/octet-stream']],
  ['/rive/vendor/rive.js', ['boing-site/rive/vendor/rive.js', 'text/javascript; charset=utf-8']],
  ['/rive/vendor/rive.wasm', ['boing-site/rive/vendor/rive.wasm', 'application/wasm']],
  ['/rive/vendor/rive_fallback.wasm', ['boing-site/rive/vendor/rive_fallback.wasm', 'application/wasm']],
  ['/app/', ['boing-app/index.html', 'text/html; charset=utf-8']],
  ['/app/style.css', ['boing-app/style.css', 'text/css; charset=utf-8']],
  ['/app/logo/boing-approved.png', ['boing-app/logo/boing-approved.png', 'image/png']],
  ['/app/app.mjs', ['boing-app/app.mjs', 'text/javascript; charset=utf-8']],
  ['/app/api.mjs', ['boing-app/api.mjs', 'text/javascript; charset=utf-8']],
])
const fixtures = {
  'demo-sprout': { name: 'Sprout Studio', projects: [{ id: 'demo-garden', name: 'Garden', organization_name: 'Sprout Studio', repository: 'example/garden', website_url: 'https://example.com' }] },
  'demo-orbit': { name: 'Orbit Lab', projects: [{ id: 'demo-comet', name: 'Comet', organization_name: 'Orbit Lab', repository: 'example/comet', website_url: null }] },
}

const banner = '<div role="note" style="background:#1a1a1a;color:white;padding:12px 18px;font:600 14px system-ui;text-align:center">LOCAL DEVELOPMENT PREVIEW · Fictional data · No real sign-in or integrations</div>'
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)) }

export function createPreviewServer() {
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' })
    if (path === '/api/boing/organizations') return json(res, 200, { organizations: Object.entries(fixtures).map(([id, f]) => ({ id, name: f.name })), truncated: false })
    if (path.startsWith('/api/boing/')) {
      const fixture = fixtures[req.headers['x-boing-organization']]
      if (!fixture) return json(res, 404, { error: 'not_found' })
      if (path === '/api/boing/projects') return json(res, 200, { projects: fixture.projects })
      const project = fixture.projects.find(item => path.startsWith(`/api/boing/projects/${item.id}/`))
      if (!project) return json(res, 404, { error: 'not_found' })
      const suffix = path.slice(`/api/boing/projects/${project.id}/`.length)
      if (suffix === 'snapshot' || suffix === 'presentation') return json(res, 404, { error: 'not_found' })
      if (suffix === 'export') return json(res, 200, {
        project: { id: project.id, name: project.name, repository: project.repository, websiteUrl: project.website_url },
        snapshot: null,
        presentation: null,
      })
      if (suffix === 'sources') {
        const generatedAt = new Date().toISOString()
        const github = { kind: 'github', available: true, generatedAt, data: { metrics: { stars: 128, forks: 19 }, traffic: { views: { status: 'available', count: 430 } } }, lastCollection: { status: 'completed' } }
        const website = project.website_url ? { kind: 'website', available: true, generatedAt, data: { status: 'available', performanceScore: 86 }, lastCollection: { status: 'completed' } } : { kind: 'website', available: false, generatedAt: null, data: null }
        return json(res, 200, { sources: [github, website] })
      }
      return json(res, 404, { error: 'not_found' })
    }
    const file = files.get(path)
    if (!file) return json(res, 404, { error: 'not_found' })
    try {
      let content = await readFile(resolve(root, file[0]))
      if (file[1].startsWith('text/html')) {
        content = content.toString('utf8').replace('<body>', `<body>${banner}`).replaceAll('https://app.boing.run/', '/app/')
        if (path === '/app/') content = content.replace('<form class="signout" action="/auth/logout" method="post"><button type="submit">Sign out</button></form>', '<a href="/">Preview home</a>')
      }
      res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : content)
    } catch { json(res, 500, { error: 'preview_unavailable' }) }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.BOING_PREVIEW_PORT || 4178)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid BOING_PREVIEW_PORT')
  createPreviewServer().listen(port, '127.0.0.1', () => process.stdout.write(`Fictional-data preview: http://127.0.0.1:${port}/\n`))
}
