import { defineConfig } from 'vitest/config'

// The core's tests only: viewer/ is its own package, with its own tests.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
