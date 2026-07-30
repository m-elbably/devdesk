import { defineConfig } from 'vitest/config'

// Root config: runs every package's *.test.ts. Package-specific setups (jsdom for
// Vue components) live in their own vitest.config.ts and are picked up by projects.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
