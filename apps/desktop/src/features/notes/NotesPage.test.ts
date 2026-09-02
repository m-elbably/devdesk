import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { lockVault } from '@/lib/vault'
import { activeWorkspaceId, workspaces } from '@/services/workspace'
import UApp from '@nuxt/ui/components/App.vue'
import type { Note, Workspace } from '@devdesk/shared'
import NotesPage from './NotesPage.vue'

const mock = vi.hoisted(() => ({
  notes: [] as Note[],
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  removeNote: vi.fn(),
  listTasks: vi.fn(),
  listNotebooks: vi.fn(),
  createNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  removeNotebook: vi.fn(),
  workspace: undefined as Workspace | undefined,
  listWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
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
    notebooks: {
      list: mock.listNotebooks,
      create: mock.createNotebook,
      update: mock.updateNotebook,
      remove: mock.removeNotebook,
    },
    workspaces: {
      list: mock.listWorkspaces,
      update: mock.updateWorkspace,
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
    notebookId: null,
    isProtected: false,
    encrypted: null,
    ...overrides,
  }
}

beforeEach(() => {
  lockVault()
  mock.notes = []
  mock.workspace = { id: 'default', home: { toolIds: [], noteIds: [], snippetIds: [] } } as unknown as Workspace
  activeWorkspaceId.value = 'default'
  workspaces.value = [mock.workspace]
  mock.listNotes.mockReset().mockImplementation(async () => mock.notes)
  mock.createNote.mockReset().mockImplementation(async (data: Partial<Note>) => {
    const created = note({ id: 'new-note', ...data })
    mock.notes = [created]
    return created
  })
  mock.updateNote.mockReset().mockImplementation(async (_id, patch: Partial<Note>) => ({ ...mock.notes[0], ...patch }))
  mock.removeNote.mockReset().mockResolvedValue(undefined)
  mock.listTasks.mockReset().mockResolvedValue([])
  mock.listNotebooks.mockReset().mockResolvedValue([])
  mock.createNotebook.mockReset().mockImplementation(async (data) => ({ id: 'nb1', parentId: null, ...data }))
  mock.updateNotebook.mockReset().mockResolvedValue(undefined)
  mock.removeNotebook.mockReset().mockResolvedValue(undefined)
  mock.listWorkspaces.mockReset().mockImplementation(async () => mock.workspace ? [mock.workspace] : [])
  mock.updateWorkspace.mockReset().mockImplementation(async (_id: string, patch: Partial<Workspace>) => {
    mock.workspace = { ...mock.workspace, ...patch } as Workspace
    workspaces.value = mock.workspace ? [mock.workspace] : []
    return mock.workspace
  })
  localStorage.clear()
})

// Toolbar tooltips and dropdowns need Nuxt UI's providers, which the real app
// gets from <UApp>.
const mountedPages: ReturnType<typeof mount>[] = []
function mountPage() {
  const wrapper = mount({ components: { UApp, NotesPage }, template: '<UApp><NotesPage /></UApp>' }, { attachTo: document.body })
  mountedPages.push(wrapper)
  return wrapper
}
function treeRow(wrapper: ReturnType<typeof mountPage>, label: string) {
  const row = wrapper.findAll('[data-testid="note-tree"] [data-slot="link"]').find((node) => node.text().startsWith(label))
  if (!row) throw new Error(`tree row "${label}" not found`)
  return row
}

// Nuxt UI modals teleport to document.body, so they're outside the VTU wrapper.
async function setDialogTags(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Comma separated"]')
  if (!input) throw new Error('tags input not found in the open dialog')
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}
async function clickSaveDetails() {
  const btn = Array.from(document.body.querySelectorAll<HTMLElement>('button')).find((button) => button.textContent?.trim() === 'Done')
  if (!btn) throw new Error('Done button not found in the open dialog')
  btn.click()
  await nextTick()
}

afterEach(() => {
  mountedPages.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('NotesPage', () => {
  it('lists notes in the tree and opens them in the rich editor', async () => {
    mock.notes = [note()]
    const wrapper = mountPage()

    await flushPromises()
    await treeRow(wrapper, 'Readme').trigger('click')
    await flushPromises()

    expect(wrapper.find('[contenteditable="true"] h1').text()).toBe('Hello')
    expect(wrapper.find('[contenteditable="true"] strong').text()).toBe('bold')
  })

  it('updates the protection icon and blocks encrypted notes while the vault is locked', async () => {
    mock.notes = [
      note({ id: 'plain', title: 'Plain' }),
      note({ id: 'private', title: 'Private', body: 'must not render', encrypted: { version: 2, keyHash: 'other-key', iv: 'iv', ciphertext: 'ciphertext' } }),
    ]
    const wrapper = mountPage()
    await flushPromises()

    await treeRow(wrapper, 'Plain').trigger('click')
    await flushPromises()
    const protect = wrapper.find('[aria-label="Protect note"]')
    expect(protect.exists()).toBe(true)
    await protect.trigger('click')
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Protect note')

    await treeRow(wrapper, 'Private').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="Protected note"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Protected note')
    expect(wrapper.text()).not.toContain('must not render')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Unlock note')).toBe(true)
  })

  it('does not save an unchanged locked note from Note details', async () => {
    mock.notes = [note({ id: 'private', title: 'Private', body: 'must not render', encrypted: { version: 2, keyHash: 'other-key', iv: 'iv', ciphertext: 'ciphertext' } })]
    const wrapper = mountPage()
    await flushPromises()
    await treeRow(wrapper, 'Private').trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="Note details"]').trigger('click')
    await nextTick()
    await clickSaveDetails()
    await flushPromises()

    expect(mock.updateNote).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('nests notes under their folder', async () => {
    mock.notes = [note({ id: 'n2', title: 'Filed', notebookId: 'nb1' })]
    mock.listNotebooks.mockResolvedValue([{ id: 'nb1', name: 'Work', parentId: null }])
    const wrapper = mountPage()
    await flushPromises()

    // Collapsed by default: the folder shows, its note does not.
    expect(wrapper.text()).toContain('Work')
    expect(() => treeRow(wrapper, 'Filed')).toThrow()

    await treeRow(wrapper, 'Work').trigger('click')
    await flushPromises()
    expect(treeRow(wrapper, 'Filed').exists()).toBe(true)
  })

  it('names new folders in a dialog, not window.prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt')
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('[aria-label="New folder"]').trigger('click')
    await nextTick()
    expect(prompt).not.toHaveBeenCalled()

    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')
    if (!input) throw new Error('folder name input not found')
    input.value = 'Specs'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const save = Array.from(document.body.querySelectorAll<HTMLElement>('[role="dialog"] button')).find((b) => b.textContent?.trim() === 'Save')
    save?.click()
    await flushPromises()

    expect(mock.createNotebook).toHaveBeenCalledWith({ name: 'Specs', parentId: null })
  })

  it('creates a note directly and opens the editor tools', async () => {
    const wrapper = mountPage()

    await flushPromises()
    await wrapper.find('[data-testid="new-note"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(mock.createNote).toHaveBeenCalledWith({ title: 'Untitled', body: '', tags: [], notebookId: null })
    // Modals render (teleported to body) only while open — creating a note must
    // not trip the unsaved-changes prompt.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.find('[aria-label="Note details"]').exists()).toBe(true)
  })

  it('pins and unpins the selected note from Note details', async () => {
    mock.notes = [note()]
    const wrapper = mountPage()
    await flushPromises()
    await treeRow(wrapper, 'Readme').trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="Note details"]').trigger('click')
    await nextTick()

    const pinButton = () => Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Pin note')
    pinButton()?.click()
    await flushPromises()
    expect(mock.updateWorkspace).toHaveBeenCalledWith('default', expect.objectContaining({ home: expect.objectContaining({ noteIds: ['n1'] }) }))

    const unpinButton = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Unpin note')
    expect(unpinButton).toBeTruthy()
    unpinButton?.click()
    await flushPromises()
    expect(mock.updateWorkspace).toHaveBeenLastCalledWith('default', expect.objectContaining({ home: expect.objectContaining({ noteIds: [] }) }))
  })

  it('does not mark a note unsaved just for opening it', async () => {
    // The editor re-pads table cells on load; that rewrite used to count as an
    // edit and got written back on the next note switch.
    mock.notes = [note({ body: 'Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n' })]
    const wrapper = mountPage()
    await flushPromises()
    await treeRow(wrapper, 'Readme').trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Save')).toBe(false)
    expect(mock.updateNote).not.toHaveBeenCalled()
  })

  it('confirms deletion of the selected row on the Delete key', async () => {
    mock.notes = [note()]
    const wrapper = mountPage()
    await flushPromises()
    await treeRow(wrapper, 'Readme').trigger('click')
    await flushPromises()

    // Typing in a field must not delete the note.
    const title = wrapper.find<HTMLInputElement>('[aria-label="Note title"]')
    title.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Readme')
  })

  it('expands the folder a new note lands in', async () => {
    mock.listNotebooks.mockResolvedValue([{ id: 'nb1', name: 'Work', parentId: null }])
    const wrapper = mountPage()
    await flushPromises()

    await treeRow(wrapper, 'Work').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="new-note"]').trigger('click')
    await flushPromises()

    expect(mock.createNote).toHaveBeenCalledWith({ title: 'Untitled', body: '', tags: [], notebookId: 'nb1' })
    expect(treeRow(wrapper, 'Untitled').exists()).toBe(true)
  })

  it('keeps failed metadata saves dirty and persists tags on retry', async () => {
    mock.notes = [note()]
    mock.updateNote.mockRejectedValueOnce(new Error('Disk full'))
    const wrapper = mountPage()

    await flushPromises()
    await treeRow(wrapper, 'Readme').trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="Note details"]').trigger('click')
    await nextTick()
    await setDialogTags('docs, local')
    await clickSaveDetails()
    await flushPromises()

    expect(document.body.textContent).toContain('Disk full')

    await clickSaveDetails()
    await flushPromises()
    expect(mock.updateNote).toHaveBeenLastCalledWith('n1', expect.objectContaining({ tags: ['docs', 'local'] }))
  })
})
