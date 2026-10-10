// Builds the single-file versions, for pages with no bundler: everything in
// one file, the worker's code inside it.
//
//   dist/bedrock-skin-viewer.min.js       a classic <script>: window.BedrockSkinViewer
//   dist/bedrock-skin-viewer.esm.min.js   an ES module: import { SkinViewer } from '...'
import { build } from 'esbuild'

const common = { bundle: true, minify: true, target: 'es2022', platform: 'browser', legalComments: 'none', logLevel: 'warning' }

// The worker first, as a classic script, so it runs from a Blob anywhere.
const worker = await build({ ...common, entryPoints: ['src/worker.ts'], format: 'iife', write: false })
const workerSource = worker.outputFiles[0].text

const virtual = {
  name: 'worker-source',
  setup(b) {
    b.onResolve({ filter: /^virtual:worker-source$/ }, () => ({ path: 'worker-source', namespace: 'virtual' }))
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: `export default ${JSON.stringify(workerSource)}`, loader: 'js' }))
  },
}

for (const [format, outfile] of [
  ['iife', 'dist/bedrock-skin-viewer.min.js'],
  ['esm', 'dist/bedrock-skin-viewer.esm.min.js'],
]) {
  await build({ ...common, entryPoints: ['src/standalone.ts'], format, globalName: 'BedrockSkinViewer', outfile, sourcemap: true, plugins: [virtual] })
}
console.log(`single-file builds written; the worker is ${(workerSource.length / 1024).toFixed(0)} kB of each`)
