import { defineConfig } from 'tsup'

// One build, two module formats: dist/index.js (ES modules: import, browsers,
// bundlers) and dist/index.cjs (CommonJS: require), each with its types.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
})
