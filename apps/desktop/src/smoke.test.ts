import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// useRouterState only works when called during setup. Mirror that here: outside
// an active component instance it returns undefined, exactly as the real one
// does — a lazy call inside a computed getter must fail this test, not pass it.
vi.mock('@tanstack/vue-router', async () => {
  const { getCurrentInstance, ref } = await import('vue')
  return {
    useRouter: () => ({ navigate: vi.fn() }),
    useRouterState: () =>
      getCurrentInstance() ? ref({ location: { pathname: '/' } }) : undefined,
    Link: { name: 'Link', template: '<a><slot /></a>' },
  }
})

import BoardPage from './features/board/BoardPage.vue'
import SettingsPage from './features/settings/SettingsPage.vue'
import DashboardPage from './features/dashboard/DashboardPage.vue'
import TaskCard from './features/board/TaskCard.vue'
import TaskDialog from './features/board/TaskDialog.vue'
import ToolInfoDialog from './features/tools/ToolInfoDialog.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import Sidebar from './components/Sidebar.vue'

const task = {
  id: 't1', workspaceId: 'default', userId: null, revision: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
  title: 'Ship it', description: 'body', status: 'todo', priority: 'high',
  tags: ['api'], dueDate: null, order: 0,
}

// Renders each page/component migrated to Nuxt UI. Catches the failure mode a
// class-only migration hits: a component that compiles but throws on mount
// (bad prop enum, missing item value, unresolved component).
describe('renders without errors', () => {
  const cases: [string, unknown, Record<string, unknown>][] = [
    ['BoardPage', BoardPage, {}],
    ['SettingsPage', SettingsPage, {}],
    ['DashboardPage', DashboardPage, {}],
    ['Sidebar', Sidebar, {}],
    ['TaskCard', TaskCard, { task }],
    ['TaskDialog', TaskDialog, { open: true, task: null }],
    ['ToolInfoDialog', ToolInfoDialog, { toolId: 'base64', open: true }],
    ['MarkdownEditor', MarkdownEditor, { modelValue: '# hi' }],
  ]

  for (const [name, component, props] of cases) {
    it(name, async () => {
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
      const wrapper = mount(component as never, { props } as never)
      await flushPromises()
      spy.mockRestore()
      expect(errors, `${name} logged errors`).toEqual([])
      expect(wrapper.html()).toBeTruthy()
    })
  }
})
