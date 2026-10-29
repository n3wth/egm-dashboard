// Live-reload preview of the EGM sign-in page.
// Usage: npm run preview:login   (PORT=5190 by default, ?state=signin|invite|pending|...)
// Re-imports auth-pages.mjs per request, rebuilds the Rive animation from
// assets/branding/egm-handoff.rml with the Rive CLI, and reloads open tabs on change.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (...p) => path.join(root, ...p)
const port = Number(process.env.PORT) || 5190
const pagesFile = at('egm-cloudflare/auth-pages.mjs')
const animFile = at('egm-cloudflare/login-animation.js')
const rml = at('assets/branding/egm-handoff.rml')
const checkedInRiv = at('assets/branding/egm-handoff.riv')
const rive = [path.join(os.homedir(), '.local/bin/rive'), path.join(os.homedir(), '.rive/bin/rive')].find(existsSync)
const project = path.join(os.tmpdir(), 'egm-login-rive')
const rivePkg = at('egm-performance/node_modules/@rive-app/canvas')

const types = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.wasm': 'application/wasm', '.riv': 'application/octet-stream' }
const staticFiles = {
  '/favicon.svg': at('assets/branding/favicon-dark.svg'),
  '/rive/rive.js': path.join(rivePkg, 'rive.js'),
  '/rive/rive.wasm': path.join(rivePkg, 'rive.wasm'),
  '/rive/egm-login.js': animFile,
}
const states = [...readFileSync(pagesFile, 'utf8').matchAll(/^ {2}(\w+): \{title:/gm)].map(m => m[1])
const clients = new Set()
let builtRiv = null

const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms) } }
const reload = debounce(() => { for (const res of clients) res.write('data: reload\n\n') }, 100)

function build() {
  if (!rive) return console.log('rive CLI not found; serving checked-in egm-handoff.riv')
  if (!existsSync(project)) {
    const r = spawn(rive, ['create', project], { stdio: 'ignore' })
    return r.on('close', code => (code === 0 ? build() : console.log(`rive create failed (${code})`)))
  }
  copyFileSync(rml, path.join(project, 'scene.rml'))
  let out = ''
  const proc = spawn(rive, ['--once', project])
  proc.stdout.on('data', d => (out += d))
  proc.stderr.on('data', d => (out += d))
  proc.on('error', err => console.log(`rive failed to start: ${err.message}`))
  proc.on('close', code => {
    const dir = path.join(project, 'build')
    const riv = code === 0 && existsSync(dir) && readdirSync(dir).filter(f => f.endsWith('.riv'))
    if (riv?.length === 1) {
      builtRiv = path.join(dir, riv[0])
      console.log(`rebuilt animation (${statSync(builtRiv).size} bytes)`)
    } else {
      console.log(`rive build failed (exit ${code}), keeping previous animation:\n${out.trim()}`)
    }
    reload()
  })
}

async function page(url) {
  const mod = await import(`${pathToFileURL(pagesFile)}?v=${statSync(pagesFile).mtimeMs}`)
  const res = mod.renderAccessPage(url.searchParams.get('state') || 'signin')
  const html = (await res.text()).replace('</body>', "<script>new EventSource('/__reload').onmessage = () => location.reload()</script></body>")
  return { html, status: res.status }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const send = (status, type, body) => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body)
  try {
    if (url.pathname === '/') {
      const { html, status } = await page(url)
      return send(status, 'text/html;charset=utf-8', html)
    }
    if (url.pathname === '/__reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      const ping = setInterval(() => res.write(': keep-alive\n\n'), 15000)
      return req.on('close', () => { clearInterval(ping); clients.delete(res) })
    }
    let file = staticFiles[url.pathname]
    if (url.pathname === '/rive/egm-handoff.riv') file = builtRiv || checkedInRiv
    const font = url.pathname.match(/^\/fonts\/([\w.-]+\.woff2)$/)
    if (font) file = at('egm-performance/public/fonts', font[1])
    if (!file || !existsSync(file)) return send(404, 'text/plain', 'not found')
    send(200, types[path.extname(file)] || 'application/octet-stream', await readFile(file))
  } catch (err) {
    console.log(err)
    send(500, 'text/plain', String(err.stack || err))
  }
})

for (const file of [pagesFile, animFile]) watch(file, reload)
watch(rml, debounce(build, 150))
server.listen(port, '127.0.0.1', () => {
  console.log(`Login preview: http://127.0.0.1:${port}/`)
  console.log(`States: ${states.map(s => `?state=${s}`).join(' ')}`)
  console.log('Watching: egm-cloudflare/auth-pages.mjs, egm-cloudflare/login-animation.js, assets/branding/egm-handoff.rml')
  build()
})
process.on('SIGINT', () => {
  for (const res of clients) res.end()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
})
