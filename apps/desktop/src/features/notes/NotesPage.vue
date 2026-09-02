<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { useRouter } from '@tanstack/vue-router'
import type { Note, Notebook, Task } from '@devdesk/shared'
import { LockKeyhole, StickyNote } from 'lucide-vue-next'
import { BaseModal, EmptyState, ErrorState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import RichMarkdownEditor from '@/components/RichMarkdownEditor.vue'
import { services } from '@/services'
import { activeWorkspace, reloadWorkspaces, updateWorkspaceHome } from '@/services/workspace'
import { bus, openRequest } from '@/lib/events'
import { isNoteUnlocked, isProtectedNote, lockKey, unlockNote } from '@/lib/vault'
import { useCollection } from '@/composables/useCollection'

type Row = { value: string; label: string; kind: 'note' | 'folder' | 'group'; id: string; icon?: string; children?: Row[] }

const router = useRouter()
const col = useCollection('note', () => services.notes.list(), (note) => `${note.title} ${note.body} ${note.tags.join(' ')}`)
const notebooks = ref<Notebook[]>([]), tasks = ref<Task[]>([]), error = ref('')
const title = ref(''), body = ref(''), tags = ref(''), taskId = ref(''), notebookId = ref('')
const saving = ref(false), editor = ref<{ focus: () => void; loaded: () => void }>()
const tagFilter = ref(''), currentFolder = ref<string | null>(null), selectedKey = ref<string | null>(null)
const metaOpen = ref(false), vaultOpen = ref(false), vaultPassphrase = ref('')
const vaultAction = ref<'protect' | 'unlock' | 'change-key'>('unlock'), vaultError = ref('')
const metaError = ref('')
const nameOpen = ref(false), nameValue = ref(''), nameMode = ref<'folder-new' | 'folder-rename' | 'view'>('folder-new'), nameTarget = ref<string | null>(null)
const deleteTarget = ref<{ kind: 'note' | 'folder'; id: string; label: string } | null>(null)
const savedViews = useLocalStorage<{ name: string; notebookId: string | null; tag: string }[]>('devdesk.notes.views', [])
const expandedKeys = useLocalStorage<string[]>('devdesk.notes.expanded', [])
const fail = (cause: unknown) => (error.value = cause instanceof Error ? cause.message : String(cause))
const tagList = computed(() => tags.value.split(',').map((tag) => tag.trim()).filter(Boolean))
const snapshot = () => JSON.stringify([title.value, body.value, tags.value, taskId.value, notebookId.value])
const savedSnapshot = ref('')
const dirty = computed(() => !!col.selectedId.value && snapshot() !== savedSnapshot.value)
const selected = computed(() => col.selected.value)
const selectedProtected = computed(() => !!selected.value && isProtectedNote(selected.value))
const selectedUnlocked = computed(() => !!selected.value && isNoteUnlocked(selected.value))
const linkedTask = computed(() => tasks.value.find((task) => task.id === taskId.value))
const allTags = computed(() => [...new Set(col.items.value.flatMap((note) => note.tags))].sort())
const pinnedIds = computed(() => activeWorkspace()?.home.noteIds ?? [])

// ── Tree ────────────────────────────────────────────────────────────────────
// Folders nest folders and their notes; unfiled notes sit at the root. While a
// search or tag filter is on, empty folders drop out and everything expands.
const filtering = computed(() => !!col.search.value.trim() || !!tagFilter.value)
const visibleNotes = computed(() => col.items.value.filter((note) => {
  const query = col.search.value.trim().toLowerCase()
  if (query && !`${note.title} ${note.body} ${note.tags.join(' ')}`.toLowerCase().includes(query)) return false
  return !tagFilter.value || note.tags.includes(tagFilter.value)
}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
function noteRow(note: Note, prefix = 'note'): Row {
  return { value: `${prefix}:${note.id}`, id: note.id, kind: 'note', label: note.title || 'Untitled', icon: isProtectedNote(note) ? 'i-lucide-lock-keyhole' : 'i-lucide-file-text' }
}
function notesIn(parentId: string | null) { return visibleNotes.value.filter((note) => (note.notebookId ?? null) === parentId).map((note) => noteRow(note)) }
function foldersIn(parentId: string | null): Row[] {
  return notebooks.value.filter((nb) => (nb.parentId ?? null) === parentId).sort((a, b) => a.name.localeCompare(b.name)).flatMap((nb) => {
    const children = [...foldersIn(nb.id), ...notesIn(nb.id)]
    return filtering.value && !children.length ? [] : [{ value: `folder:${nb.id}`, id: nb.id, kind: 'folder' as const, label: nb.name, children }]
  })
}
const tree = computed<Row[]>(() => {
  const pinned = visibleNotes.value.filter((note) => pinnedIds.value.includes(note.id))
  return [
    ...(pinned.length ? [{ value: 'group:pinned', id: '', kind: 'group' as const, label: 'Pinned', icon: 'i-lucide-pin', children: pinned.map((note) => noteRow(note, 'pin')) }] : []),
    ...foldersIn(null),
    ...notesIn(null),
  ]
})
const flat = computed(() => {
  const rows: Row[] = []
  const walk = (items: Row[]) => items.forEach((item) => { rows.push(item); if (item.children) walk(item.children) })
  walk(tree.value)
  return rows
})
const expanded = computed({
  get: () => filtering.value ? flat.value.filter((row) => row.children?.length).map((row) => row.value) : expandedKeys.value,
  set: (keys: string[]) => { if (!filtering.value) expandedKeys.value = keys },
})
const selectedRow = computed({
  get: () => flat.value.find((row) => row.value === selectedKey.value) ?? undefined,
  set: (row: Row | undefined) => {
    if (!row) return
    selectedKey.value = row.value
    if (row.kind === 'folder') currentFolder.value = row.id
    if (row.kind === 'note') { currentFolder.value = col.items.value.find((note) => note.id === row.id)?.notebookId ?? null; openNote(row.id) }
  },
})
function rowMenu(row: Row) {
  if (row.kind === 'folder') return [
    [{ label: 'New note', icon: 'i-lucide-file-plus', onSelect: () => { currentFolder.value = row.id; void create() } },
      { label: 'New folder', icon: 'i-lucide-folder-plus', onSelect: () => askName('folder-new', row.id) }],
    [{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => askName('folder-rename', row.id, row.label) },
      { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => (deleteTarget.value = { kind: 'folder', id: row.id, label: row.label }) }],
  ]
  return [[
    { label: pinnedIds.value.includes(row.id) ? 'Unpin' : 'Pin', icon: 'i-lucide-pin', onSelect: () => void togglePinned(row.id) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => (deleteTarget.value = { kind: 'note', id: row.id, label: row.label }) },
  ]]
}

// ── Details dialog options ──────────────────────────────────────────────────
const notebookOptions = computed(() => [{ label: 'No notebook', value: 'none' }, ...notebooks.value.map((n) => ({ label: n.name, value: n.id }))])
const taskOptions = computed(() => [{ label: 'No linked task', value: 'none' }, ...tasks.value.map((t) => ({ label: t.title, value: t.id }))])
const notebookSelection = computed({ get: () => notebookId.value || 'none', set: (value: string) => (notebookId.value = value === 'none' ? '' : value) })
const taskSelection = computed({ get: () => taskId.value || 'none', set: (value: string) => (taskId.value = value === 'none' ? '' : value) })

async function reloadNotebooks() { notebooks.value = await services.notebooks.list() }
onMounted(async () => { try { await reloadNotebooks(); tasks.value = await services.tasks.list() } catch (cause) { fail(cause) } })
const off = bus.on('entity:mutated', (event) => { if (event.kind === 'notebook') void reloadNotebooks() })
const vaultOff = bus.on('vault:changed', async () => { await col.reload(); syncFields() })
onBeforeUnmount(() => { off(); vaultOff() })
function syncFields() {
  const note = selected.value
  title.value = note?.title ?? ''; body.value = note?.body ?? ''; tags.value = (note?.tags ?? []).join(', ')
  taskId.value = note?.taskId ?? ''; notebookId.value = note?.notebookId ?? ''
  savedSnapshot.value = snapshot()
  editor.value?.loaded()
}
watch(col.selectedId, (id) => {
  syncFields()
  if (id && !selectedKey.value?.endsWith(`:${id}`)) selectedKey.value = `note:${id}`
})
watch(openRequest, (request) => { if (request?.kind === 'note' && col.items.value.some((note) => note.id === request.id)) { openNote(request.id); openRequest.value = null } })

function openNote(id: string) { if (dirty.value && id !== col.selectedId.value) { void saveNow().then((ok) => { if (ok) col.selectedId.value = id }); return }; col.selectedId.value = id }
async function saveNow(): Promise<boolean> {
  const id = col.selectedId.value
  if (!id || saving.value) return false
  if (!dirty.value) return true
  saving.value = true
  try {
    await services.notes.update(id, { title: title.value, body: body.value, tags: tagList.value, taskId: taskId.value || null, notebookId: notebookId.value || null } as never)
    savedSnapshot.value = snapshot()
    return true
  } catch (cause) {
    if (metaOpen.value) metaError.value = cause instanceof Error ? cause.message : String(cause)
    else fail(cause)
    return false
  } finally { saving.value = false }
}
async function create() { if (dirty.value && !(await saveNow())) return; try { const note = await services.notes.create({ title: 'Untitled', body: '', tags: [], notebookId: currentFolder.value } as never); expandFolder(currentFolder.value); await col.reload(); col.selectedId.value = note.id; await nextTick(); editor.value?.focus() } catch (cause) { fail(cause) } }
async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  try {
    if (target.kind === 'note') { await services.notes.remove(target.id); if (col.selectedId.value === target.id) { col.selectedId.value = null; selectedKey.value = null }; await col.reload() }
    else { await services.notebooks.remove(target.id); if (currentFolder.value === target.id) currentFolder.value = null; await col.reload() }
  } catch (cause) { fail(cause) }
  deleteTarget.value = null
}
function askName(mode: typeof nameMode.value, target: string | null = null, value = '') { nameMode.value = mode; nameTarget.value = target; nameValue.value = value; nameOpen.value = true }
async function submitName() {
  const value = nameValue.value.trim()
  if (!value) return
  try {
    if (nameMode.value === 'view') savedViews.value = [...savedViews.value.filter((view) => view.name !== value), { name: value, notebookId: currentFolder.value, tag: tagFilter.value }]
    else if (nameMode.value === 'folder-rename' && nameTarget.value) await services.notebooks.update(nameTarget.value, { name: value } as never)
    else { const notebook = await services.notebooks.create({ name: value, parentId: nameTarget.value } as never); expandFolder(nameTarget.value); expandFolder(notebook.id); currentFolder.value = notebook.id }
    await reloadNotebooks()
  } catch (cause) { fail(cause) }
  nameOpen.value = false
}
function expandFolder(id: string | null) { if (id) expandedKeys.value = [...new Set([...expandedKeys.value, `folder:${id}`])] }
function applyView(view: { notebookId: string | null; tag: string }) { tagFilter.value = view.tag; currentFolder.value = view.notebookId; if (view.notebookId) { selectedKey.value = `folder:${view.notebookId}` }; expandFolder(view.notebookId) }
async function togglePinned(id = selected.value?.id) {
  if (!id) return
  try {
    if (!activeWorkspace()) await reloadWorkspaces()
    const workspace = activeWorkspace()
    if (!workspace) throw new Error('Workspace is still loading.')
    const noteIds = pinnedIds.value.includes(id) ? pinnedIds.value.filter((noteId) => noteId !== id) : [...pinnedIds.value, id]
    await updateWorkspaceHome({ toolIds: workspace.home.toolIds, noteIds, snippetIds: workspace.home.snippetIds })
  } catch (cause) { fail(cause) }
}
async function toggleProtected() {
  const note = selected.value
  if (!note) return
  if (isProtectedNote(note)) {
    if (!selectedUnlocked.value) return openVault('unlock')
    try { await services.notes.unprotect(note.id); await col.reload(); metaOpen.value = false } catch (cause) { fail(cause) }
  } else {
    if (dirty.value && !(await saveNow())) return
    openVault('protect')
  }
}
function openVault(action: typeof vaultAction.value) { vaultAction.value = action; vaultError.value = ''; vaultPassphrase.value = ''; vaultOpen.value = true; metaOpen.value = false }
async function submitVault() {
  const note = selected.value
  if (!note) return
  vaultError.value = ''
  try {
    if (vaultAction.value === 'protect') await services.notes.protect(note.id, vaultPassphrase.value)
    else if (vaultAction.value === 'change-key') await services.notes.changeKey(note.id, vaultPassphrase.value)
    else await unlockNote(note, vaultPassphrase.value)
    vaultPassphrase.value = ''; vaultOpen.value = false; await col.reload()
  } catch (cause) { vaultError.value = cause instanceof Error ? cause.message : String(cause) }
}
function openLinkedTask() { if (taskId.value) { openRequest.value = { kind: 'task', id: taskId.value, nonce: Date.now() }; void router.navigate({ to: '/board' as never }) } }
// Delete removes the selected row, but only from the tree — never while the
// caret is in the title, the editor or a dialog field.
function typing(target: EventTarget | null) { return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) }
function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveNow(); return }
  const row = selectedRow.value
  if (event.key !== 'Delete' || typing(event.target) || !row || row.kind === 'group' || deleteTarget.value) return
  event.preventDefault()
  deleteTarget.value = { kind: row.kind, id: row.id, label: row.label }
}
onMounted(() => window.addEventListener('keydown', onKeydown)); onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <PageShell title="" fill fluid>
    <div class="flex h-full min-h-0 flex-col gap-3">
      <ErrorState v-if="error" :message="error" @retry="error = ''" />
      <div class="grid flex-1 min-h-0 gap-3 lg:grid-cols-[19rem_1fr]">
        <!-- Library -->
        <aside class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-default bg-default">
          <div class="flex items-center gap-1 border-b border-default p-1">
            <UInput v-model="col.search.value" type="search" icon="i-lucide-search" placeholder="Search notes…" variant="none" size="sm" class="min-w-0 flex-1" />
            <UTooltip text="New folder"><UButton size="xs" color="neutral" variant="ghost" square icon="i-lucide-folder-plus" aria-label="New folder" @click="askName('folder-new', currentFolder)" /></UTooltip>
            <UTooltip text="New note"><UButton data-testid="new-note" size="xs" color="primary" variant="soft" square icon="i-lucide-plus" aria-label="New note" @click="create" /></UTooltip>
          </div>

          <UTree
            v-if="tree.length"
            v-model="selectedRow"
            v-model:expanded="expanded"
            data-testid="note-tree"
            :items="tree"
            :get-key="(row: Row) => row.value"
            :as="{ link: 'div' }"
            size="sm"
            class="min-h-0 flex-1 overflow-y-auto p-1"
            :ui="{ link: 'group cursor-pointer' }"
          >
            <template #item-trailing="{ item, expanded: open }">
              <UDropdownMenu v-if="item.kind !== 'group'" :items="rowMenu(item)" :content="{ align: 'start' }">
                <UButton
                  size="xs" color="neutral" variant="ghost" square icon="i-lucide-ellipsis"
                  :aria-label="`Actions for ${item.label}`" class="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                  @click.stop
                />
              </UDropdownMenu>
              <UIcon v-if="item.children?.length" :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0 text-dimmed" />
            </template>
          </UTree>
          <p v-else class="flex-1 p-6 text-center text-sm text-muted">{{ filtering ? 'No matching notes' : 'No notes yet' }}</p>

          <div v-if="allTags.length || savedViews.length" class="border-t border-default p-2">
            <div v-if="allTags.length" class="flex flex-wrap gap-1">
              <UButton v-for="tag in allTags" :key="tag" size="xs" color="neutral" :variant="tagFilter === tag ? 'soft' : 'ghost'" @click="tagFilter = tagFilter === tag ? '' : tag">#{{ tag }}</UButton>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-bookmark-plus" @click="askName('view')">Save view</UButton>
              <UButton v-for="view in savedViews" :key="view.name" size="xs" color="neutral" variant="ghost" @click="applyView(view)">{{ view.name }}</UButton>
            </div>
          </div>
        </aside>

        <!-- Note -->
        <section v-if="selected" class="flex min-h-0 min-w-0 flex-col gap-3">
          <div class="flex items-center gap-2">
            <UInput v-model="title" :disabled="selectedProtected && !selectedUnlocked" variant="none" placeholder="Untitled" aria-label="Note title" class="min-w-0 flex-1" :ui="{ base: 'text-2xl font-bold px-2 py-1 rounded-md bg-elevated/50 ring ring-transparent hover:ring-accented focus:ring-primary focus:bg-elevated/50 transition' }" />
            <UButton v-if="dirty" size="sm" color="primary" :loading="saving" @click="saveNow">Save</UButton>
            <UButton size="sm" color="neutral" variant="ghost" :icon="selectedProtected && selectedUnlocked ? 'i-lucide-lock-open' : 'i-lucide-lock-keyhole'" :title="selectedProtected ? (selectedUnlocked ? 'Lock this key' : 'Unlock protected note') : 'Protect note'" :aria-label="selectedProtected ? (selectedUnlocked ? 'Unlocked protected note' : 'Protected note') : 'Protect note'" @click="selectedProtected ? (selectedUnlocked ? lockKey(selected) : openVault('unlock')) : openVault('protect')" />
            <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-settings-2" title="Details" aria-label="Note details" @click="metaError = ''; metaOpen = true" />
            <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="Delete note" @click="deleteTarget = { kind: 'note', id: selected.id, label: title || 'Untitled' }" />
          </div>
          <div v-if="selectedProtected && !selectedUnlocked" class="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-default text-center text-muted">
            <LockKeyhole class="mb-3 size-9" />
            <p class="font-medium">Protected note</p>
            <UButton class="mt-3" size="sm" color="primary" @click="openVault('unlock')">Unlock note</UButton>
          </div>
          <template v-else>
            <div v-if="linkedTask || tagList.length" class="flex flex-wrap gap-1">
              <UButton v-if="linkedTask" size="xs" color="primary" variant="subtle" @click="openLinkedTask">{{ linkedTask.title }}</UButton>
              <UBadge v-for="tag in tagList" :key="tag" size="sm" color="neutral" variant="subtle">#{{ tag }}</UBadge>
            </div>
            <RichMarkdownEditor ref="editor" v-model="body" placeholder="Write a note…" />
          </template>
        </section>
        <EmptyState v-else title="No note selected" description="Create a note or choose one from the tree.">
          <template #icon><StickyNote class="size-10 opacity-40" /></template>
        </EmptyState>
      </div>
    </div>

    <BaseModal :open="metaOpen" title="Note details" box-class="sm:max-w-lg" @close="metaOpen = false">
      <div class="space-y-5">
        <section class="space-y-3">
          <div>
            <h3 class="text-sm font-semibold">Organization</h3>
            <p class="text-xs text-muted">Choose where this note belongs and what it connects to.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Notebook"><USelect v-model="notebookSelection" :items="notebookOptions" :disabled="selectedProtected && !selectedUnlocked" class="w-full" /></UFormField>
            <UFormField label="Linked task"><USelect v-model="taskSelection" :items="taskOptions" :disabled="selectedProtected && !selectedUnlocked" class="w-full" /></UFormField>
          </div>
          <UFormField label="Tags"><UInput v-model="tags" placeholder="Comma separated" :disabled="selectedProtected && !selectedUnlocked" class="w-full" /></UFormField>
          <p v-if="selectedProtected && !selectedUnlocked" class="text-xs text-muted">Unlock the note to edit its organization details.</p>
        </section>

        <USeparator />

        <section class="overflow-hidden rounded-lg border border-default">
          <div class="flex items-center justify-between gap-3 bg-elevated p-3">
            <div class="flex min-w-0 items-center gap-3">
              <UIcon :name="selectedProtected ? (selectedUnlocked ? 'i-lucide-lock-open' : 'i-lucide-lock-keyhole') : 'i-lucide-file-text'" class="size-5 shrink-0 text-muted" />
              <h3 class="min-w-0 truncate text-sm font-semibold">Protection <span class="font-normal text-muted">· {{ selectedProtected ? (selectedUnlocked ? 'open on this device' : 'locked') : 'plain text' }}</span></h3>
            </div>
            <UBadge :color="!selectedProtected ? 'neutral' : selectedUnlocked ? 'success' : 'warning'" variant="soft" size="sm">{{ selectedProtected ? (selectedUnlocked ? 'Unlocked' : 'Locked') : 'Plain' }}</UBadge>
          </div>
          <div class="grid gap-2 border-t border-default p-3 sm:grid-cols-2">
            <UButton v-if="!selectedProtected" block size="sm" color="neutral" variant="outline" icon="i-lucide-lock-keyhole" @click="toggleProtected">Protect note</UButton>
            <UButton v-else-if="!selectedUnlocked" block size="sm" color="primary" variant="soft" icon="i-lucide-lock-keyhole-open" @click="openVault('unlock')">Unlock note</UButton>
            <template v-else>
              <UButton block size="sm" color="neutral" variant="outline" icon="i-lucide-key-round" @click="openVault('change-key')">Change key</UButton>
              <UButton block size="sm" color="neutral" variant="outline" icon="i-lucide-lock-keyhole" @click="lockKey(selected!)">Lock note</UButton>
              <UButton block class="sm:col-span-2" size="sm" color="neutral" variant="ghost" icon="i-lucide-file-text" @click="toggleProtected">Make plain</UButton>
            </template>
          </div>
        </section>

        <ErrorState v-if="metaError" :message="metaError" />

        <div class="flex items-center justify-between gap-3 border-t border-default pt-4">
          <UButton size="sm" color="neutral" variant="ghost" :icon="pinnedIds.includes(selected?.id ?? '') ? 'i-lucide-pin-off' : 'i-lucide-pin'" :aria-pressed="pinnedIds.includes(selected?.id ?? '')" @click="togglePinned()">{{ pinnedIds.includes(selected?.id ?? '') ? 'Unpin note' : 'Pin note' }}</UButton>
          <UButton size="sm" color="primary" :loading="saving" @click="saveNow().then((ok) => { if (ok) metaOpen = false })">Done</UButton>
        </div>
      </div>
    </BaseModal>

    <BaseModal :open="nameOpen" :title="nameMode === 'view' ? 'Save current view' : nameMode === 'folder-rename' ? 'Rename folder' : 'New folder'" @close="nameOpen = false">
      <UInput v-model="nameValue" autofocus class="w-full" :placeholder="nameMode === 'view' ? 'View name' : 'Folder name'" @keyup.enter="submitName" />
      <div class="flex justify-end gap-2 pt-4">
        <UButton size="sm" color="neutral" variant="ghost" @click="nameOpen = false">Cancel</UButton>
        <UButton size="sm" color="primary" :disabled="!nameValue.trim()" @click="submitName">Save</UButton>
      </div>
    </BaseModal>

    <BaseModal :open="!!deleteTarget" :title="deleteTarget?.kind === 'folder' ? 'Delete folder' : 'Delete note'" @close="deleteTarget = null">
      <p>Delete “{{ deleteTarget?.label }}”?<span v-if="deleteTarget?.kind === 'folder'" class="block pt-2 text-sm text-muted">Its notes and subfolders move up to the parent folder.</span></p>
      <div class="flex justify-end gap-2 pt-4">
        <UButton size="sm" color="neutral" variant="ghost" @click="deleteTarget = null">Cancel</UButton>
        <UButton size="sm" color="error" @click="confirmDelete">Delete</UButton>
      </div>
    </BaseModal>

    <BaseModal :open="vaultOpen" :title="vaultAction === 'protect' ? 'Protect note' : vaultAction === 'change-key' ? 'Change note key' : 'Unlock note'" @close="vaultOpen = false; vaultError = ''">
      <div class="space-y-3">
        <p class="text-sm text-muted">{{ vaultAction === 'change-key' ? 'Enter a new key for this note.' : 'The key stays on this device only as a derived hash; it is kept in memory only until locked.' }}</p>
        <UFormField :error="vaultError">
          <UInput v-model="vaultPassphrase" type="password" autofocus :placeholder="vaultAction === 'change-key' ? 'New unlock key' : 'Vault passphrase'" class="w-full" @keyup.enter="submitVault" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton size="sm" color="primary" @click="submitVault">{{ vaultAction === 'protect' ? 'Protect note' : vaultAction === 'change-key' ? 'Change key' : 'Unlock' }}</UButton>
        </div>
      </div>
    </BaseModal>
  </PageShell>
</template>
