import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Snippet } from '@devdesk/shared'
import SnippetsPage from './SnippetsPage.vue'

const mock = vi.hoisted(() => ({
  snippets: [] as Snippet[],
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listTasks: vi.fn(),
}))

vi.mock('@/services', () => ({
  services: {
    snippets: { list: mock.list, create: mock.create, update: mock.update, remove: mock.remove },
    tasks: { list: mock.listTasks },
  },
}))
vi.mock('@tanstack/vue-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }))

const snippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: 's1', workspaceId: 'default', userId: null, revision: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
  title: 'Untitled', code: '', language: 'markdown', tags: [], taskId: null, ...overrides,
})

beforeEach(() => {
  mock.snippets = []
  mock.list.mockReset().mockImplementation(async () => mock.snippets)
  mock.create.mockReset().mockImplementation(async (data: Partial<Snippet>) => {
    const created = snippet(data)
    mock.snippets = [created]
    return created
  })
  mock.update.mockReset().mockResolvedValue(snippet())
  mock.remove.mockReset().mockResolvedValue(undefined)
  mock.listTasks.mockReset().mockResolvedValue([])
})

describe('SnippetsPage', () => {
  it('reloads and selects a newly created snippet before opening its editor', async () => {
    const wrapper = mount(SnippetsPage)

    await flushPromises()
    await wrapper.find('[data-testid="new-snippet"]').trigger('click')
    await flushPromises()

    expect(mock.list).toHaveBeenCalledTimes(2)
    expect((wrapper.find('input[placeholder="Untitled"]').element as HTMLInputElement).value).toBe('Untitled')
    expect(wrapper.find('textarea').exists()).toBe(true)
  })
})
