import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@devdesk/database',
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
})
