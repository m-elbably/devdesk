<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouterState, Link } from '@tanstack/vue-router'
import { LayoutPanelLeft } from 'lucide-vue-next'
import { getToolByRoute } from '@devdesk/tools'
import { desktop } from '@/services/desktop'
import ThemeSwitcher from './ThemeSwitcher.vue'
import { useOnline } from '@/composables/useOnline'
import { syncStatus } from '@/services/sync'
import { activeWorkspace } from '@/services/workspace'
import { assistantOpen, toggleAssistant } from '@/features/assistant/state'

const { online } = useOnline()

const syncLabel = {
  'signed-out': 'Signed out',
  idle: 'Synced',
  syncing: 'Syncing',
  offline: 'Offline',
  error: 'Sync error',
}
const syncIcon = {
  'signed-out': 'i-lucide-circle-slash',
  idle: 'i-lucide-check-circle',
  syncing: 'i-lucide-refresh-cw',
  offline: 'i-lucide-cloud-off',
  error: 'i-lucide-alert-circle',
}
const syncColor = {
  'signed-out': 'text-dimmed',
  idle: 'text-success',
  syncing: 'text-info animate-spin',
  offline: 'text-warning',
  error: 'text-error',
}

// Breadcrumbs from the path segments — good enough while routes are shallow.
// A slug only titleizes back into the real name by luck ("range-cidr" is not
// "IP Range ⇄ CIDR", "jwt" is not "JWT Parser", "board" is not "Tasks"), so ask
// the registry first, then this override map, then fall back to the slug.
const ROUTE_LABELS: Record<string, string> = { '/board': 'Tasks' }
const state = useRouterState()
const crumbs = computed(() => {
  const path = state.value.location.pathname
  const segs = path.split('/').filter(Boolean)
  let acc = ''
  return segs.map((s) => {
    acc += `/${s}`
    return {
      label: getToolByRoute(acc)?.name ?? ROUTE_LABELS[acc] ?? s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      to: acc,
      // ponytail: '/tools' has no page of its own — render it as plain text.
      link: acc !== '/tools',
    }
  })
})

// Reflect the current location in the native window / browser tab title.
watch(
  crumbs,
  (c) => void desktop.setWindowTitle(c.length ? `DevDesk — ${c[c.length - 1]!.label}` : 'DevDesk'),
  { immediate: true },
)

const openPalette = () => window.dispatchEvent(new CustomEvent('devdesk:open-palette'))
const openWorkspaceSwitcher = () => window.dispatchEvent(new CustomEvent('devdesk:open-workspace-switcher'))
const openQuickCapture = () => window.dispatchEvent(new CustomEvent('devdesk:quick-capture'))
</script>

<template>
  <header class="flex items-center gap-3 h-14 px-4 border-b border-default bg-default shrink-0">
    <nav class="flex items-center gap-1.5 text-sm flex-1 min-w-0" aria-label="Breadcrumbs">
      <Link to="/" class="flex items-center gap-1.5 text-muted hover:text-highlighted transition-colors shrink-0">
        <LayoutPanelLeft class="size-4" />
        DevDesk
      </Link>
      <template v-for="(c, i) in crumbs" :key="c.to">
        <span class="text-dimmed shrink-0">/</span>
        <component
          :is="c.link ? Link : 'span'"
          :to="c.link ? c.to : undefined"
          class="truncate transition-colors"
          :class="i === crumbs.length - 1 ? 'text-highlighted font-medium' : c.link ? 'text-muted hover:text-highlighted' : 'text-muted'"
        >
          {{ c.label }}
        </component>
      </template>
    </nav>

    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-search"
      class="w-56 justify-between"
      title="Search (Ctrl+K)"
      @click="openPalette"
    >
      <span class="text-dimmed">Search...</span>
      <template #trailing>
        <span class="flex items-center gap-1">
          <UKbd>⌘</UKbd>
          <UKbd>K</UKbd>
        </span>
      </template>
    </UButton>

    <UButton color="neutral" variant="ghost" icon="i-lucide-plus" title="Quick capture (Ctrl+Shift+Space)" aria-label="Quick capture" @click="openQuickCapture" />

    <UButton
      :color="assistantOpen ? 'primary' : 'neutral'"
      :variant="assistantOpen ? 'subtle' : 'ghost'"
      icon="i-lucide-sparkles"
      title="AI assistant (Ctrl+I)"
      aria-label="AI assistant"
      @click="toggleAssistant"
    />

    <UTooltip text="Switch workspace (Ctrl+W)">
      <button type="button" class="shrink-0" @click="openWorkspaceSwitcher">
        <UBadge color="neutral" variant="subtle" size="sm" icon="i-lucide-layout-panel-left">
          {{ activeWorkspace()?.name ?? 'Workspace' }}
        </UBadge>
      </button>
    </UTooltip>

    <UTooltip :text="syncLabel[syncStatus]">
      <UIcon :name="syncIcon[syncStatus]" class="size-4" :class="syncColor[syncStatus]" />
    </UTooltip>

    <UTooltip :text="online ? 'Online' : 'Offline'">
      <UIcon v-if="online" name="i-lucide-wifi" class="size-4 text-success" />
      <UIcon v-else name="i-lucide-wifi-off" class="size-4 text-warning" />
    </UTooltip>

    <ThemeSwitcher />
  </header>
</template>
