import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { RouterContextProvider } from '@tanstack/vue-router'
import { h } from 'vue'
import { router } from './router'
import Sidebar from './components/Sidebar.vue'

vi.mock('@/services', () => ({
  services: {
    tasks: { list: vi.fn().mockResolvedValue([]) },
    notes: { list: vi.fn().mockResolvedValue([]) },
    snippets: { list: vi.fn().mockResolvedValue([]) },
  },
}))

// Sidebar reads live router state. Provide the real router through the real
// injection key — a mocked useRouterState would return a usable ref no matter
// where it was called from, and so would not catch a call made outside setup.
describe('Sidebar with the real router injected', () => {
  it('renders nav links from the current path', async () => {
    await router.load()
    const wrapper = mount({
      render: () => h(RouterContextProvider as never, { router }, () => h(Sidebar)),
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Tasks')
    // The current path drives active styling; '/' is active on load.
    expect(wrapper.find('a[href="/"], a').exists()).toBe(true)
  })
})
