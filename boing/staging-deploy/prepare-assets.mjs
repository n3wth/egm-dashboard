import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(here, 'dist')
const source = resolve(here, '../app')
const files = ['index.html', 'account.html', 'account.mjs', 'admin.html', 'admin.mjs', 'style.css', 'app.mjs', 'api.mjs', 'members.mjs', 'invitations.mjs', 'archive.mjs', 'audit.mjs', 'history.mjs', 'logo/boing-approved.png']
await rm(output, { recursive: true, force: true })
for (const file of files) {
  await mkdir(dirname(resolve(output, file)), { recursive: true })
  await copyFile(resolve(source, file), resolve(output, file))
}

// Bundle the project's module graph into the existing entry point. The Worker
// continues to authenticate every asset request, but the browser no longer
// fetches each imported module separately on initial load.
await build({ entryPoints: [resolve(source, 'app.mjs')], outfile: resolve(output, 'app.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' })
