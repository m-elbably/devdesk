<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from '@tanstack/vue-router'
import type { Task } from '@devdesk/shared'
import { Code2 } from 'lucide-vue-next'
import { BaseModal, EmptyState, ErrorState, CopyButton } from '@devdesk/ui'
import PageShell from '@/components/PageShell.vue'
import CodeBlock from '@/components/CodeBlock.vue'
import { services } from '@/services'
import { bus, openRequest } from '@/lib/events'
import { useCollection } from '@/composables/useCollection'

const LANGS = ['markdown', 'text', 'javascript', 'typescript', 'python', 'json', 'bash', 'sql', 'go', 'rust', 'html', 'css']

const col = useCollection(
  'snippet',
  async () => {
    try {
      return await services.snippets.list()
    } catch (e) {
      fail(e)
      return []
    }
  },
  (s) => `${s.title} ${s.code} ${(s.tags ?? []).join(' ')}`,
)

const title = ref('')
const code = ref('')
const language = ref('markdown')
const tags = ref('')
const taskId = ref('')
const editing = ref(false)
const error = ref('')
const saving = ref(false)
const router = useRouter()

const fail = (e: unknown) => (error.value = e instanceof Error ? e.message : String(e))

const tasks = ref<Task[]>([])
onMounted(async () => {
  try {
    tasks.value = await services.tasks.list()
  } catch (e) {
    fail(e)
  }
})
const linkedTask = computed(() => tasks.value.find((t) => t.id === taskId.value))
const tagList = computed(() => tags.value.split(',').map((s) => s.trim()).filter(Boolean))
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

// Title / language / tags / linked-task live in a dialog to keep the editing surface clean.
const metaOpen = ref(false)

// Dirty tracking: compare live fields against the last persisted snapshot rather
// than the cached collection (which isn't refreshed on save). savedSnapshot is
// reset whenever we load a snippet or successfully save one.
const snapshot = () => JSON.stringify([title.value, code.value, language.value, tags.value, taskId.value])
const savedSnapshot = ref('')
const dirty = computed(() => !!col.selectedId.value && snapshot() !== savedSnapshot.value)

// Seed the editor only when the selected snippet changes (not on every reload) to avoid save loops.
watch(col.selectedId, () => {
  const s = col.selected.value
  title.value = s?.title ?? ''
  code.value = s?.code ?? ''
  language.value = s?.language ?? 'markdown'
  tags.value = (s?.tags ?? []).join(', ')
  taskId.value = s?.taskId ?? ''
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
    await services.snippets.update(id, {
      title: title.value,
      code: code.value,
      language: language.value,
      tags: tagList.value,
      taskId: taskId.value || null,
    } as never)
    savedSnapshot.value = current
    bus.emit('toast', { type: 'success', message: 'Snippet saved.' })
    return true
  } catch (e) {
    fail(e)
    return false
  } finally {
    saving.value = false
  }
}

// Autosave every N ms if enabled in Settings (0 = off). Mirrors NotesPage.
// ponytail: setInterval polling dirty, not a per-keystroke debounce.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  const ms = Number(localStorage.getItem('devdesk.autosaveMs') ?? 300000)
  if (ms > 0) timer = setInterval(() => dirty.value && saveNow(), ms)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  if (dirty.value) void saveNow()
})

// Switching snippets with unsaved changes prompts via the dialog below.
const promptOpen = ref(false)
const pendingId = ref<string | null>(null)

function openSnippet(id: string) {
  if (dirty.value && id !== col.selectedId.value) {
    pendingId.value = id
    promptOpen.value = true
    return
  }
  col.selectedId.value = id
  editing.value = false
}

// Command palette → open a specific snippet. Gated on the item being loaded:
// selecting before useCollection finishes loading would leave `col.selected`
// null, so the seed-on-select watch above blanks the fields. Re-runs when items
// arrive (navigation) or when the request changes (already on this page).
function applyOpen() {
  const r = openRequest.value
  if (r?.kind !== 'snippet' || !col.items.value.some((i) => i.id === r.id)) return
  openSnippet(r.id)
  openRequest.value = null
}
watch(openRequest, applyOpen)
watch(() => col.items.value.length, applyOpen)

async function saveAndGo() {
  if (await saveNow()) goToPending()
}
function discardAndGo() {
  savedSnapshot.value = snapshot() // drop dirty state; the snippet switch reseeds fields
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
    const s = await services.snippets.create({ title: 'Untitled', code: '', language: 'markdown', tags: [] } as never)
    await col.reload()
    openSnippet(s.id)
    await nextTick()
    editing.value = true
  } catch (e) {
    fail(e)
  }
}

const deleteOpen = ref(false)

async function remove() {
  const id = col.selectedId.value
  if (!id) return
  error.value = ''
  try {
    await services.snippets.remove(id)
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
            <h1 v-else class="truncate text-2xl font-bold">Snippets</h1>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <template v-if="col.selected.value">
              <UButton v-if="dirty" color="primary" size="sm" icon="i-lucide-save" title="Save (Ctrl+S)" :loading="saving" @click="saveNow">
                Save
              </UButton>
              <UFieldGroup size="sm">
                <CopyButton :value="code" />
                <UButton color="neutral" variant="ghost" icon="i-lucide-settings-2" title="Details" aria-label="Snippet details" @click="metaOpen = true" />
                <UButton v-if="editing" color="neutral" variant="ghost" icon="i-lucide-eye" title="View" aria-label="View snippet" @click="editing = false" />
                <UButton v-else color="neutral" variant="ghost" icon="i-lucide-pencil" title="Edit" aria-label="Edit snippet" @click="editing = true" />
                <UButton color="error" variant="ghost" icon="i-lucide-trash-2" title="Delete" aria-label="Delete snippet" @click="deleteOpen = true" />
              </UFieldGroup>
            </template>
            <UIcon
              v-if="col.selected.value"
              :name="saving ? 'i-lucide-loader-circle' : dirty ? 'i-lucide-circle-dashed' : 'i-lucide-circle-check'"
              :class="['size-4 text-default/40', saving && 'animate-spin']"
              :title="saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'"
              :aria-label="saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'"
            />
            <UButton data-testid="new-snippet" color="primary" size="sm" icon="i-lucide-plus" @click="create">New</UButton>
          </div>
        </div>

        <aside class="flex flex-col min-h-0 rounded-lg border border-default bg-default overflow-hidden md:col-start-1 md:row-start-1 md:row-span-2">
          <UInput
            v-model="col.search.value"
            type="search"
            size="sm"
            icon="i-lucide-search"
            placeholder="Search title & code…"
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
          <ul v-else data-testid="snippet-list" class="w-full flex-1 gap-0 overflow-y-auto p-0">
            <li v-for="s in col.filtered.value" :key="s.id">
              <UButton
                block
                color="neutral"
                variant="ghost"
                :class="[
                  'h-auto justify-start rounded-none border-b border-muted px-4 py-2',
                  s.id === col.selectedId.value ? 'bg-primary/10 text-primary font-medium' : '',
                ]"
                @click="openSnippet(s.id)"
              >
                <span class="min-w-0 flex-1 text-left">
                  <span class="block truncate">{{ s.title || 'Untitled' }}</span>
                  <span class="block truncate text-xs font-normal text-default/45">{{ modified(s.updatedAt) }} · {{ s.code || 'Empty snippet' }}</span>
                </span>
                <UBadge color="neutral" variant="subtle" size="sm" class="ml-auto shrink-0">{{ s.language }}</UBadge>
              </UButton>
            </li>
            <li v-if="!col.filtered.value.length" class="p-6 text-center text-sm text-default/50">
              {{ col.search.value ? 'No matching snippets' : 'No snippets yet' }}
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
          <CodeBlock
            v-if="editing"
            editable
            line-numbers
            fill
            :code="code"
            :language="language"
            placeholder="Paste code…"
            class="flex-1 min-h-0"
            @update:code="code = $event"
          />
          <CodeBlock v-else :code="code" :language="language" line-numbers fill class="flex-1 min-h-0" />
        </section>
        <EmptyState v-else title="No snippet selected" description="Create or pick a snippet." class="md:col-start-2 md:row-start-2">
          <template #icon><Code2 class="size-10 opacity-40" /></template>
        </EmptyState>
      </div>
    </div>

    <BaseModal :open="metaOpen" title="Snippet details" @close="metaOpen = false">
      <div class="space-y-3">
        <UFormField label="Language">
          <USelect v-model="language" :items="LANGS" class="w-full" />
        </UFormField>
        <UFormField label="Tags">
          <UInput v-model="tags" class="w-full" placeholder="Tags (comma separated)" />
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
      <p class="text-sm">You have unsaved changes to this snippet. Save before switching?</p>
      <div class="flex justify-end gap-2 pt-4">
        <UButton color="neutral" variant="ghost" size="sm" @click="discardAndGo">Discard</UButton>
        <UButton color="primary" size="sm" @click="saveAndGo">Save</UButton>
      </div>
    </BaseModal>

    <BaseModal :open="deleteOpen" title="Delete snippet" @close="deleteOpen = false">
      <p class="text-sm">Delete “{{ title || 'Untitled' }}”?</p>
      <div class="flex justify-end gap-2 pt-4">
        <UButton color="neutral" variant="ghost" size="sm" @click="deleteOpen = false">Cancel</UButton>
        <UButton color="error" size="sm" @click="remove">Delete</UButton>
      </div>
    </BaseModal>
  </PageShell>
</template>
