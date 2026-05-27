import { defineConfig } from 'vitest/config'
import { buildCoverageConfig } from './vitest.shared.ts'

export default defineConfig({
  test: {
    coverage: buildCoverageConfig(),
    environment: 'node',
    exclude: ['node_modules/', 'dist/', 'reference/'],
    globals: true,
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
  },
})
