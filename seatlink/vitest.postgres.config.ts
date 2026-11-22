import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/postgres.integration.ts'],
    hookTimeout: 60000,
    testTimeout: 15000,
  },
})
