import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Note } from '@devdesk/shared'
import NotesPage from './NotesPage.vue'

const mock = vi.hoisted(() => ({
  notes: [] as Note[],
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  removeNote: vi.fn(),
  listTasks: vi.fn(),
}))

vi.mock('@/services', () => ({
  services: {
    notes: {
      list: mock.listNotes,
      create: mock.createNote,
      update: mock.updateNote,
      remove: mock.removeNote,
    },
    tasks: {
      list: mock.listTasks,
    },
  },
}))
vi.mock('@tanstack/vue-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }))

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    workspaceId: 'default',
    userId: null,
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 'Readme',
    body: '# Hello\n\n**bold**',
    tags: [],
    taskId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mock.notes = []
  mock.listNotes.mockReset().mockImplementation(async () => mock.notes)
  mock.createNote.mockReset().mockImplementation(async (data: Partial<Note>) => {
    const created = note({ id: 'new-note', ...data })
    mock.notes = [created]
    return created
  })
  mock.updateNote.mockReset().mockImplementation(async (_id, patch: Partial<Note>) => ({ ...mock.notes[0], ...patch }))
  mock.removeNote.mockReset().mockResolvedValue(undefined)
  mock.listTasks.mockReset().mockResolvedValue([])
})

// Nuxt UI modals teleport to document.body, so they're outside the VTU wrapper.
async function setDialogTags(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Comma separated"]')
  if (!input) throw new Error('tags input not found in the open dialog')
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}
async function clickSaveDetails() {
  const btn = document.body.querySelector<HTMLElement>('[data-testid="save-details"]')
  if (!btn) throw new Error('Done button not found in the open dialog')
  btn.click()
  await nextTick()
}

describe('NotesPage', () => {
  it('opens existing notes in rendered markdown view mode', async () => {
    mock.notes = [note()]
    const wrapper = mount(NotesPage)

    await flushPromises()
    await wrapper.find('[data-testid="note-list"] button').trigger('click')
    await nextTick()

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('.prose h1').text()).toBe('Hello')
    expect(wrapper.find('.prose strong').text()).toBe('bold')
  })

  it('creates a note directly and opens the editor tools', async () => {
    const wrapper = mount(NotesPage)

    await flushPromises()
    await wrapper.find('[data-testid="new-note"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(mock.createNote).toHaveBeenCalledWith({ title: 'Untitled', body: '', tags: [] })
    // Modals render (teleported to body) only while open — creating a note must
    // not trip the unsaved-changes prompt.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Bold"]').exists()).toBe(true)
  })

  it('keeps failed metadata saves dirty and persists tags on retry', async () => {
    mock.notes = [note()]
    mock.updateNote.mockRejectedValueOnce(new Error('Disk full'))
    const wrapper = mount(NotesPage)

    await flushPromises()
    await wrapper.find('[data-testid="note-list"] button').trigger('click')
    await wrapper.find('[aria-label="Note details"]').trigger('click')
    await nextTick()
    await setDialogTags('docs, local')
    await clickSaveDetails()
    await flushPromises()

    expect(wrapper.text()).toContain('Disk full')
    expect(wrapper.find('[aria-label="Unsaved changes"]').exists()).toBe(true)

    await clickSaveDetails()
    await flushPromises()
    expect(mock.updateNote).toHaveBeenLastCalledWith('n1', expect.objectContaining({ tags: ['docs', 'local'] }))
    expect(wrapper.find('[aria-label="Saved"]').exists()).toBe(true)
  })
})
