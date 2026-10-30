import { resolve } from 'node:path'

export default {
  resolve: {
    alias: {
      react: resolve('egm-performance/node_modules/react'),
      'react-dom': resolve('egm-performance/node_modules/react-dom'),
    },
  },
  build: {
    outDir: '/tmp/boing-egm-evidence-build',
    emptyOutDir: true,
    lib: { entry: resolve('boing-egm/ProjectEvidence.jsx'), formats: ['es'], fileName: 'project-evidence' },
  },
}
