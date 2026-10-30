import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createBoingWorker } from './boing-worker.mjs'

test('every prepared staging asset is served to a verified session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boing-assets-'))
  try {
    const deploy = join(root, 'boing-staging-deploy')
    await cp(resolve('boing-staging-deploy/prepare-assets.mjs'), join(deploy, 'prepare-assets.mjs'), { recursive: true })
    await symlink(resolve('boing-staging-deploy/node_modules'), join(deploy, 'node_modules'), 'dir')
    await cp(resolve('boing-app'), join(root, 'boing-app'), { recursive: true })
    await promisify(execFile)(process.execPath, [join(deploy, 'prepare-assets.mjs')])
    const dist = join(deploy, 'dist')
    const bundle = await readFile(join(dist, 'app.mjs'), 'utf8')
    assert.doesNotMatch(bundle, /^import\s/m, 'app entry must not fetch additional modules')
    assert.match(bundle, /\/api\/boing\/invitations/, 'workspace invitation code is included')
    const files = await readdir(dist, { recursive: true, withFileTypes: true })
    const paths = files.filter(entry => entry.isFile()).map(entry => '/' + join(entry.parentPath ?? entry.path, entry.name).slice(dist.length + 1))
    assert.ok(paths.includes('/invitations.mjs'))
    const env = {
      APP_URL: 'https://app.test',
      ASSETS: { async fetch(request) {
        const path = new URL(request.url).pathname
        try { return new Response(await readFile(join(dist, path))) } catch { return new Response(null, { status: 404 }) }
      } }
    }
    const worker = createBoingWorker({ authenticate: async () => ({ status: 'active', user: { id: 'user_123', status: 'active', verified: 1 } }) })
    for (const path of paths) {
      const response = await worker.fetch(new Request(`https://app.test${path}`, { headers: { cookie: `__Host-boing_session=${'a'.repeat(43)}` } }), env)
      assert.equal(response.status, 200, `${path} is prepared but cannot be served`)
      assert.equal(response.headers.get('cache-control'), 'private, no-store', path)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
