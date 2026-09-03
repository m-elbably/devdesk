import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { EntityKind } from '@devdesk/shared'
import { bus } from '@/lib/events'

/**
 * Generic loader for a list-backed feature. Loads via `load`
 * and refreshes whenever a matching entity mutates. `searchText` drives filtering.
 */
export function useCollection<T extends { id: string }>(
  kind: EntityKind,
  load: () => Promise<T[]>,
  searchText: (item: T) => string,
) {
  const items = ref<T[]>([]) as { value: T[] }
  const search = ref('')
  const selectedId = ref<string | null>(null)
  const loading = ref(true)

  async function reload() {
    try {
      items.value = await load()
      if (selectedId.value && !items.value.some((i) => i.id === selectedId.value)) {
        selectedId.value = items.value[0]?.id ?? null
      }
    } finally {
      loading.value = false
    }
  }

  const filtered = computed(() => {
    const q = search.value.toLowerCase()
    return q ? items.value.filter((i) => searchText(i).toLowerCase().includes(q)) : items.value
  })
  const selected = computed(() => items.value.find((i) => i.id === selectedId.value) ?? null)

  let off: (() => void) | undefined
  onMounted(() => {
    void reload()
    off = bus.on('entity:mutated', (e) => e.kind === kind && reload())
  })
  onUnmounted(() => off?.())

  return { items, filtered, search, selectedId, selected, loading, reload }
}
