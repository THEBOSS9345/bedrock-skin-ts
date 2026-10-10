import { defineConfig } from 'tsup'

// ES modules for browsers and bundlers. worker.js is its own file, which the
// viewer starts with new Worker(new URL('./worker.js', import.meta.url)), a
// form every major bundler recognises and bundles.
export default defineConfig({
  entry: ['src/index.ts', 'src/element.ts', 'src/react.tsx', 'src/worker.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  target: 'es2022',
  platform: 'browser',
  external: ['bedrock-skin', 'react', 'react/jsx-runtime'],
})
