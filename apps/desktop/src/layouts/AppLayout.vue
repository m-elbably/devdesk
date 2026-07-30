<script setup lang="ts">
import { ref, watch } from 'vue'
import { Outlet, useRouterState } from '@tanstack/vue-router'
import Sidebar from '@/components/Sidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import EditContextMenu from '@/components/EditContextMenu.vue'
import { LayoutPanelLeft } from 'lucide-vue-next'

// Sidebar is a fixed rail on lg+; below lg it lives in a slide-over opened by
// the hamburger, and closes on navigation.
const mobileNavOpen = ref(false)
const state = useRouterState()
watch(
  () => state.value.location.pathname,
  () => (mobileNavOpen.value = false),
)
</script>

<template>
  <div class="flex h-screen">
    <Sidebar class="hidden lg:flex shrink-0" />

    <div class="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
      <div class="flex items-center gap-2 lg:hidden h-14 px-2 border-b border-default bg-default shrink-0">
        <UButton icon="i-lucide-menu" color="neutral" variant="ghost" size="sm" aria-label="Open menu" @click="mobileNavOpen = true" />
        <LayoutPanelLeft class="size-4 text-primary" />
        <span class="font-bold text-highlighted">DevDesk</span>
      </div>

      <AppHeader class="hidden lg:flex" />

      <!-- overflow-x-hidden: pages scroll vertically only; without it, overflow-y-auto
           promotes overflow-x to auto and a stray-wide child (e.g. a tooltip) shows a
           phantom horizontal scrollbar. -->
      <main class="flex-1 overflow-y-auto overflow-x-hidden bg-canvas">
        <Outlet />
      </main>
    </div>

    <USlideover v-model:open="mobileNavOpen" side="left" title="Navigation" :ui="{ content: 'w-60' }">
      <template #content>
        <Sidebar :collapsible="false" class="w-full border-r-0" />
      </template>
    </USlideover>

    <CommandPalette />
    <WorkspaceSwitcher />
    <ToastContainer />
    <EditContextMenu />
  </div>
</template>
