<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from '@tanstack/vue-router'
import type { Task } from '@devdesk/shared'
import { StickyNote } from 'lucide-vue-next'
import { BaseModal, EmptyState, ErrorState } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { services } from '@/services'
import { bus, openRequest } from '@/lib/events'
import { useCollection } from '@/composables/useCollection'

const col = useCollection(
  'note',
  async () => {
    try {
      return await services.notes.list()
    } catch (e) {
      fail(e)
      return []
    }
  },
  (n) => `${n.title} ${n.body} ${(n.tags ?? []).join(' ')}`,
)

const title = ref('')
const body = ref('')
const tags = ref('')
const taskId = ref('')
const editing = ref(false)
const error = ref('')
const editor = ref<{ focus: () => void }>()
const saving = ref(false)
const router = useRouter()

const fail = (e: unknown) => (error.value = e instanceof Error ? e.message : String(e))

// Tasks available to link a note to.
const tasks = ref<Task[]>([])
onMounted(async () => {
  try {
    tasks.value = await services.tasks.list()
  } catch (e) {
    fail(e)
  }
})
const linkedTask = computed(() => tasks.value.find((t) => t.id === taskId.value))
// Reka UI reserves '' as the "cleared" value and rejects it as an item value,
// so "no task" needs a sentinel that maps back to the empty taskId we persist.
const NO_TASK = 'none'
const taskOptions = computed(() => [
  { label: 'No linked task', value: NO_TASK },
  ...tasks.value.map((t) => ({ label: `🔗 ${t.title}`, value: t.id })),
])
const taskSelection = computed({
  get: () => taskId.value || NO_TASK,
  set: (v: string) => (taskId.value = v === NO_TASK ? '' : v),
})
const tagList = computed(() => tags.value.split(',').map((tag) => tag.trim()).filter(Boolean))

// Title + linked-task live in a dialog to keep the editing surface clean.
const metaOpen = ref(false)

// Dirty tracking: compare live fields against the last persisted snapshot rather
// than the cached collection (which isn't refreshed on save). savedSnapshot is
// reset whenever we load a note or successfully save one.
const snapshot = () => JSON.stringify([title.value, body.value, tags.value, taskId.value])
const savedSnapshot = ref('')
const dirty = computed(() => !!col.selectedId.value && snapshot() !== savedSnapshot.value)

// Seed the editor only when the selected note changes (not on every reload) to avoid save loops.
watch(col.selectedId, () => {
  const n = col.selected.value
  title.value = n?.title ?? ''
  body.value = n?.body ?? ''
  tags.value = (n?.tags ?? []).join(', ')
  taskId.value = n?.taskId ?? ''
  savedSnapshot.value = snapshot()
  editing.value = false
})

async function saveNow(): Promise<boolean> {
  const id = col.selectedId.value
  if (!id || saving.value) return false
  error.value = ''
  saving.value = true
  const current = snapshot()
  try {
    await services.notes.update(id, {
      title: title.value,
      body: body.value,
      tags: tagList.value,
      taskId: taskId.value || null,
    } as never)
    savedSnapshot.value = current
    bus.emit('toast', { type: 'success', message: 'Note saved.' })
    return true
  } catch (e) {
    fail(e)
    return false
  } finally {
    saving.value = false
  }
}

// Autosave every N ms if enabled in Settings (0 = off). Read on mount; the notes
// route unmounts on navigation, so returning re-reads any changed setting.
// ponytail: setInterval polling dirty, not a per-keystroke debounce — the whole
// point of the redesign is explicit/periodic saving over save-on-every-keystroke.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  const ms = Number(localStorage.getItem('devdesk.autosaveMs') ?? 300000)
  if (ms > 0) timer = setInterval(() => dirty.value && saveNow(), ms)
})
// Best-effort flush on leave so navigating to another section never loses work
// (a blocking router guard would be far more code for the cross-page case).
onBeforeUnmount(() => {
  clearInterval(timer)
  if (dirty.value) void saveNow()
})

// Switching notes with unsaved changes prompts via the dialog below.
const promptOpen = ref(false)
const pendingId = ref<string | null>(null)

function openNote(id: string) {
  if (dirty.value && id !== col.selectedId.value) {
    pendingId.value = id
    promptOpen.value = true
    return
  }
  col.selectedId.value = id
  editing.value = false
}

// Command palette → open a specific note. Gated on the item being loaded:
// selecting before useCollection finishes loading would leave `col.selected`
// null, so the seed-on-select watch blanks the fields. Re-runs when items arrive
// (navigation) or when the request changes (already on this page).
function applyOpen() {
  const r = openRequest.value
  if (r?.kind !== 'note' || !col.items.value.some((i) => i.id === r.id)) return
  openNote(r.id)
  openRequest.value = null
}
watch(openRequest, applyOpen)
watch(() => col.items.value.length, applyOpen)

async function saveAndGo() {
  if (await saveNow()) goToPending()
}
function discardAndGo() {
  savedSnapshot.value = snapshot() // drop dirty state; the note switch reseeds fields
  goToPending()
}
function goToPending() {
  promptOpen.value = false
  if (pendingId.value) col.selectedId.value = pendingId.value
  pendingId.value = null
  editing.value = false
}

async function create() {
  if (dirty.value && !(await saveNow())) return
  try {
    const n = await services.notes.create({
      title: 'Untitled',
      body: '',
      tags: [],
    } as never)
    await col.reload()
    openNote(n.id)
    await nextTick()
    editing.value = true
    await nextTick()
    editor.value?.focus()
  } catch (e) {
    fail(e)
  }
}

async function doneEditing() {
  if (!dirty.value || await saveNow()) editing.value = false
}

const deleteOpen = ref(false)

async function remove() {
  const id = col.selectedId.value
  if (!id) return
  try {
    await services.notes.remove(id)
    editing.value = false
    col.selectedId.value = null
    deleteOpen.value = false
    await col.reload()
  } catch (e) {
    fail(e)
  }
}

async function saveDetails() {
  if (await saveNow()) metaOpen.value = false
}

function openLinkedTask() {
  if (!taskId.value) return
  openRequest.value = { kind: 'task', id: taskId.value, nonce: Date.now() }
  void router.navigate({ to: '/board' as never })
}

function modified(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (dirty.value) void saveNow()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <PageShell title="" fill fluid>
    <div class="flex flex-col h-full gap-4">
      <ErrorState v-if="error" :message="error" class="shrink-0" @retry="error = ''" />

      <div class="grid gap-4 grid-rows-[auto_minmax(10rem,35%)_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:grid-cols-[16rem_1fr] flex-1 min-h-0 min-w-0">
        <div class="flex items-start justify-between gap-3 md:col-start-2 md:row-start-1 min-w-0">
          <div class="min-w-0 flex-1">
            <UInput
              v-if="col.selected.value"
              v-model="title"
              placeholder="Untitled"
              variant="none"
              maxlength="120"
              class="min-w-0"
              :ui="{ base: 'text-2xl font-bold p-0 rounded px-1 -mx-1 transition-colors focus:bg-elevated!' }"
            />
            <h1 v-else class="truncate text-2xl font-bold">Notes</h1>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <template v-if="col.selected.value">
              <UButton v-if="dirty" color="primary" size="sm" icon="i-lucide-save" title="Save (Ctrl+S)" :loading="saving" @click="saveNow">
                Save
              </UButton>
              <UFieldGroup size="sm">
                <UButton color="neutral" variant="ghost" icon="i-lucide-settings-2" title="Details" aria-label="Note details" @click="metaOpen = true" />
                <UButton v-if="editing" color="neutral" variant="ghost" icon="i-lucide-eye" title="View" aria-label="View note" @click="doneEditing" />
                <UButton v-else color="neutral" variant="ghost" icon="i-lucide-pencil" title="Edit" aria-label="Edit note" @click="editing = true" />
                <UButton color="error" variant="ghost" icon="i-lucide-trash-2" title="Delete" aria-label="Delete note" @click="deleteOpen = true" />
              </UFieldGroup>
            </template>
            <UIcon
              v-if="col.selected.value"
              :name="saving ? 'i-lucide-loader-circle' : dirty ? 'i-lucide-circle-dashed' : 'i-lucide-circle-check'"
              :class="['size-4 text-default/40', saving && 'animate-spin']"
              :title="saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'"
              :aria-label="saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'"
            />
            <UButton data-testid="new-note" color="primary" size="sm" icon="i-lucide-plus" @click="create">New</UButton>
          </div>
        </div>

        <aside class="flex flex-col min-h-0 rounded-lg border border-default bg-default overflow-hidden md:col-start-1 md:row-start-1 md:row-span-2">
          <UInput
            v-model="col.search.value"
            type="search"
            size="sm"
            icon="i-lucide-search"
            placeholder="Search title & content…"
            variant="none"
            class="border-b border-default"
            :ui="{ root: 'w-full' }"
          />
          <div v-if="col.loading.value" class="flex-1 space-y-4 overflow-hidden p-4">
            <div v-for="i in 8" :key="i" class="space-y-2">
              <USkeleton class="h-4 w-3/4" />
              <USkeleton class="h-3 w-full" />
            </div>
          </div>
          <ul v-else data-testid="note-list" class="w-full flex-1 gap-0 overflow-y-auto p-0">
            <li v-for="n in col.filtered.value" :key="n.id">
              <UButton
                block
                color="neutral"
                variant="ghost"
                :class="[
                  'h-auto justify-start rounded-none border-b border-muted px-4 py-2 text-left',
                  n.id === col.selectedId.value ? 'bg-primary/10 text-primary font-medium' : '',
                ]"
                @click="openNote(n.id)"
              >
                <span class="min-w-0 flex-1 text-left">
                  <span class="block truncate">{{ n.title || 'Untitled' }}</span>
                  <span class="block truncate text-xs font-normal text-default/45">{{ modified(n.updatedAt) }} · {{ n.body || 'Empty note' }}</span>
                </span>
              </UButton>
            </li>
            <li v-if="!col.filtered.value.length" class="p-6 text-center text-sm text-default/50">
              {{ col.search.value ? 'No matching notes' : 'No notes yet' }}
            </li>
          </ul>
        </aside>

        <section v-if="col.selected.value" class="flex flex-col gap-3 min-h-0 min-w-0 md:col-start-2 md:row-start-2">
          <div v-if="linkedTask || tagList.length" class="flex flex-col gap-1 min-w-0">
            <div v-if="linkedTask">
              <UButton
                color="primary"
                variant="subtle"
                size="xs"
                icon="i-lucide-link"
                class="shrink-0 rounded-full"
                @click="openLinkedTask"
              >
                {{ linkedTask.title }}
              </UButton>
            </div>
            <div v-if="tagList.length" class="flex flex-wrap gap-1">
              <UBadge v-for="t in tagList" :key="t" color="neutral" variant="subtle" size="sm">{{ t }}</UBadge>
            </div>
          </div>
          <MarkdownEditor v-if="editing" ref="editor" v-model="body" placeholder="Write markdown…" />
          <MarkdownView v-else :source="body" class="flex-1 overflow-y-auto" />
        </section>
        <EmptyState v-else title="No note selected" description="Create or pick a note to edit." class="md:col-start-2 md:row-start-2">
          <template #icon><StickyNote class="size-10 opacity-40" /></template>
        </EmptyState>
      </div>
    </div>

    <BaseModal :open="metaOpen" title="Note details" @close="metaOpen = false">
      <div class="space-y-3">
        <UFormField label="Tags">
          <UInput v-model="tags" class="w-full" placeholder="Comma separated" />
        </UFormField>
        <UFormField label="Linked task">
          <USelect v-model="taskSelection" :items="taskOptions" class="w-full" />
        </UFormField>
        <div class="flex justify-end pt-2">
          <UButton data-testid="save-details" color="primary" size="sm" :loading="saving" @click="saveDetails">Done</UButton>
        </div>
      </div>
    </BaseModal>

    <BaseModal :open="promptOpen" title="Unsaved changes" @close="promptOpen = false">
      <p class="text-sm">You have unsaved changes to this note. Save before switching?</p>
      <div class="flex justify-end gap-2 pt-4">
        <UButton color="neutral" variant="ghost" size="sm" @click="discardAndGo">Discard</UButton>
        <UButton color="primary" size="sm" @click="saveAndGo">Save</UButton>
      </div>
    </BaseModal>

    <BaseModal :open="deleteOpen" title="Delete note" @close="deleteOpen = false">
      <p class="text-sm">Delete “{{ title || 'Untitled' }}”?</p>
      <div class="flex justify-end gap-2 pt-4">
        <UButton color="neutral" variant="ghost" size="sm" @click="deleteOpen = false">Cancel</UButton>
        <UButton color="error" size="sm" @click="remove">Delete</UButton>
      </div>
    </BaseModal>
  </PageShell>
</template>
