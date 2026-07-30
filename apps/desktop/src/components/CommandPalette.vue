<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from '@tanstack/vue-router'
import { implementedTools } from '@devdesk/tools'
import type { EntityKind } from '@devdesk/shared'
import { services } from '@/services'
import { openRequest } from '@/lib/events'
import { PRIMARY_NAV, FOOTER_NAV } from '@/lib/navigation'

interface Item {
  id: string
  label: string
  group: string
  // Not "to": UCommandPalette forwards items through Nuxt UI's pickLinkProps,
  // which treats a `to` key as a real link and renders a raw <a href> that
  // navigates outside the router (breaks hash history). Keep it inert and
  // navigate ourselves in select().
  path: string
  kind?: EntityKind // set for notes/snippets so selecting opens that exact item
  text?: string // extra searchable text (e.g. note body, snippet code); defaults to label
  icon?: string
}

const GROUP_ICONS: Record<string, string> = {
  Tools: 'i-lucide-wrench',
  Notes: 'i-lucide-sticky-note',
  Tasks: 'i-lucide-kanban-square',
  Snippets: 'i-lucide-code-2',
  'Go to': 'i-lucide-arrow-right',
}
const GROUP_ORDER = ['Go to', 'Tools', 'Notes', 'Tasks', 'Snippets']

const router = useRouter()
const open = ref(false)

// Built once per open: tools + nav are static; notes/tasks/snippets are loaded live.
const items = ref<Item[]>([])
async function buildItems() {
  const nav = [...PRIMARY_NAV.items, ...FOOTER_NAV.items].map((n) => ({
    id: `nav:${n.to}`,
    label: n.label,
    group: 'Go to',
    path: n.to,
    icon: GROUP_ICONS['Go to'],
  }))
  const tools = implementedTools().map((t) => ({ id: t.id, label: t.name, group: 'Tools', path: t.route, icon: GROUP_ICONS['Tools'] }))
  const [notes, tasks, snippets] = await Promise.all([
    services.notes.list(),
    services.tasks.list(),
    services.snippets.list(),
  ])
  items.value = [
    ...nav,
    ...tools,
    ...notes.map((n) => ({ id: n.id, label: n.title || 'Untitled note', group: 'Notes', path: '/notes', kind: 'note' as const, text: `${n.title} ${n.body}`, icon: GROUP_ICONS['Notes'] })),
    ...tasks.map((t) => ({ id: t.id, label: t.title, group: 'Tasks', path: '/board', kind: 'task' as const, icon: GROUP_ICONS['Tasks'] })),
    ...snippets.map((s) => ({ id: s.id, label: s.title || 'Untitled snippet', group: 'Snippets', path: '/snippets', kind: 'snippet' as const, text: `${s.title} ${s.code}`, icon: GROUP_ICONS['Snippets'] })),
  ]
}

const groups = computed(() =>
  GROUP_ORDER.map((name) => ({
    id: name,
    label: name,
    items: items.value.filter((i) => i.group === name),
  })).filter((g) => g.items.length),
)

async function show() {
  await buildItems()
  open.value = true
}

function select(item?: Item) {
  if (!item) return
  open.value = false
  if (item.kind) openRequest.value = { kind: item.kind, id: item.id, nonce: Date.now() }
  void router.navigate({ to: item.path })
}

function onKeydown(e: KeyboardEvent) {
  // Ctrl/Cmd+F opens the same palette (Ctrl+K too). Packaged app, so overriding
  // the browser's native find is intentional. Arrow/Enter/Esc handling lives in
  // UCommandPalette + UModal.
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
    e.preventDefault()
    open.value = !open.value
    if (open.value) void buildItems()
  }
}

const openViaEvent = () => void show()
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('devdesk:open-palette', openViaEvent)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('devdesk:open-palette', openViaEvent)
})
</script>

<template>
  <UModal
    v-model:open="open"
    :close="false"
    title="Command palette"
    description="Search tools, notes, tasks and snippets"
    :ui="{ content: 'sm:max-w-3xl top-[15vh] translate-y-0!' }"
  >
    <template #content>
      <UCommandPalette
        :groups="groups"
        placeholder="Search tools, notes, tasks…"
        :fuse="{ resultLimit: 20, fuseOptions: { keys: ['label', 'text'], ignoreLocation: true, threshold: 0.3 } }"
        class="h-96"
        @update:model-value="select($event as Item)"
      />
    </template>
  </UModal>
</template>
