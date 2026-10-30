import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')

export default {
  resolve: {
    alias: {
      react: resolve(repo, 'egm-performance/node_modules/react'),
      'react-dom': resolve(repo, 'egm-performance/node_modules/react-dom'),
    },
  },
  build: {
    outDir: '/tmp/boing-egm-evidence-build',
    emptyOutDir: true,
    lib: { entry: resolve(here, 'ProjectEvidence.jsx'), formats: ['es'], fileName: 'project-evidence' },
  },
}
