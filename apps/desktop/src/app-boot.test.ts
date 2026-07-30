import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { router } from './router'

vi.mock('@/services/desktop', () => ({
  desktop: { setWindowTitle: vi.fn(), saveTextFile: vi.fn() },
  initDesktop: vi.fn(),
}))
vi.mock('@/services/sync', () => ({
  syncUser: { value: null },
  syncStatus: { value: 'idle' },
  isAdmin: { value: false },
  login: vi.fn(),
  logout: vi.fn(),
  syncNow: vi.fn(),
  startSync: vi.fn(),
}))

// Boots the real root: UApp + RouterProvider + AppLayout, the exact tree main.ts
// mounts. Catches errors that only appear once the full provider chain is in
// place — the kind an isolated component mount cannot see.
describe('app boot', () => {
  it('renders the shell without hitting the router error boundary', async () => {
    await router.load()
    const wrapper = mount(App, { global: { plugins: [ui] } })
    await flushPromises()
    await flushPromises()

    const text = wrapper.text()
    expect(text, `render fell through to the error boundary: ${text}`).not.toContain('Try Again')
    expect(text).toContain('Tasks')
  })
})
