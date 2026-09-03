<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { Link } from '@tanstack/vue-router'
import { CATEGORY_LABELS, type ToolCategory } from '@devdesk/shared'
import { PRIMARY_NAV, ADMIN_NAV, FOOTER_NAV, CATEGORY_ICONS, type NavItem } from '@/lib/navigation'
import { APP_NAME } from '@devdesk/shared'
import { services } from '@/services'
import { isAdmin } from '@/services/sync'
import { bus } from '@/lib/events'

// collapsible=false for the mobile slide-over copy of this sidebar: it's only
// ever shown full-width, so the rail-collapse control would be dead weight there.
withDefaults(defineProps<{ collapsible?: boolean }>(), { collapsible: true })

const collapsed = useLocalStorage('devdesk:sidebar-collapsed', false)

// Tool categories become sidebar entries automatically — adding a tool category
// never requires touching this component.
const toolItems: NavItem[] = (Object.keys(CATEGORY_LABELS) as ToolCategory[]).map((cat) => ({
  label: CATEGORY_LABELS[cat],
  to: `/tools/${cat}`,
  icon: CATEGORY_ICONS[cat],
}))

// Highlight the active link via the `data-status="active"` attribute Link sets
// itself and a CSS attribute-selector variant, rather than computing the class
// ourselves from route state: Link's Vue implementation snapshots parent-passed
// attrs (incl. `class`) once at setup(), so a dynamically recomputed :class prop
// never re-applies after the first render — the highlight would freeze on
// whichever route was active on mount. data-status IS kept live by Link itself.
const linkClass =
  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-default data-[status=active]:bg-primary/10 data-[status=active]:text-primary data-[status=active]:font-medium'

// Item counts shown as badges next to their nav entry.
const counts = ref<Record<string, number>>({})
async function reloadCounts() {
  const [tasks, notes] = await Promise.all([
    services.tasks.list(),
    services.notes.list(),
  ])
  counts.value = { '/board': tasks.length, '/notes': notes.length }
}

let off: (() => void) | undefined
onMounted(() => {
  void reloadCounts()
  off = bus.on('entity:mutated', () => reloadCounts())
})
onUnmounted(() => off?.())
</script>

<template>
  <aside
    class="flex h-full flex-col border-r border-default bg-default transition-[width] duration-200"
    :class="collapsible && collapsed ? 'w-14' : 'w-60'"
  >
    <div class="flex items-center gap-2 px-4 h-14 border-b border-default shrink-0" :class="{ 'px-2 justify-center': collapsible && collapsed }">
      <template v-if="!collapsible || !collapsed">
        <!-- Bound, so plugin-vue doesn't try to resolve it as a module: it lives in public/. -->
        <img :src="`./icon.png`" alt="" class="size-6 shrink-0 rounded-md" />
        <span class="text-lg font-bold text-highlighted truncate">{{ APP_NAME }}</span>
      </template>
      <UButton
        v-if="collapsible"
        color="neutral"
        variant="ghost"
        size="sm"
        :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
        :class="collapsed ? '' : 'ml-auto'"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="collapsed = !collapsed"
      />
    </div>

    <nav class="flex-1 overflow-y-auto p-2">
      <Link
        v-for="item in PRIMARY_NAV.items"
        :key="item.to"
        :to="item.to"
        :title="collapsible && collapsed ? item.label : undefined"
        :class="[linkClass, collapsible && collapsed ? 'justify-center' : '']"
      >
        <component :is="item.icon" class="size-4 shrink-0" />
        <template v-if="!collapsible || !collapsed">
          <span class="flex-1 truncate">{{ item.label }}</span>
          <UBadge v-if="counts[item.to] !== undefined" color="neutral" variant="subtle" size="sm">
            {{ counts[item.to] }}
          </UBadge>
        </template>
      </Link>

      <p v-if="!collapsible || !collapsed" class="px-2.5 pt-5 pb-1 text-xs font-semibold uppercase tracking-wider text-dimmed">Tools</p>
      <hr v-else class="mx-2 mt-5 mb-1 border-default" />
      <Link
        v-for="item in toolItems"
        :key="item.to"
        :to="item.to"
        :title="collapsible && collapsed ? item.label : undefined"
        :class="[linkClass, collapsible && collapsed ? 'justify-center' : '']"
      >
        <component :is="item.icon" class="size-4 shrink-0" />
        <span v-if="!collapsible || !collapsed" class="flex-1 truncate">{{ item.label }}</span>
      </Link>
    </nav>

    <div class="border-t border-default p-2 shrink-0">
      <template v-if="isAdmin">
        <p v-if="!collapsible || !collapsed" class="px-2.5 pt-1 pb-1 text-xs font-semibold uppercase tracking-wider text-dimmed">
          {{ ADMIN_NAV.title }}
        </p>
        <Link
          v-for="item in ADMIN_NAV.items"
          :key="item.to"
          :to="item.to"
          :title="collapsible && collapsed ? item.label : undefined"
          :class="[linkClass, collapsible && collapsed ? 'justify-center' : '']"
        >
          <component :is="item.icon" class="size-4 shrink-0" />
          <span v-if="!collapsible || !collapsed" class="flex-1 truncate">{{ item.label }}</span>
        </Link>
        <hr class="mx-2 my-1 border-default" />
      </template>

      <Link
        v-for="item in FOOTER_NAV.items"
        :key="item.to"
        :to="item.to"
        :title="collapsible && collapsed ? item.label : undefined"
        :class="[linkClass, collapsible && collapsed ? 'justify-center' : '']"
      >
        <component :is="item.icon" class="size-4 shrink-0" />
        <span v-if="!collapsible || !collapsed" class="flex-1 truncate">{{ item.label }}</span>
      </Link>
    </div>
  </aside>
</template>
