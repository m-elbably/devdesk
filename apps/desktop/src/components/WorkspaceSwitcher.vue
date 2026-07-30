<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from '@tanstack/vue-router'
import { activeWorkspaceId, workspaces, selectWorkspace } from '@/services/workspace'

const router = useRouter()
const open = ref(false)

function pick(id: string | undefined) {
  open.value = false
  if (id && id !== activeWorkspaceId.value) selectWorkspace(id)
}

function manage() {
  open.value = false
  void router.navigate({ to: '/settings' as never })
}

function onKeydown(e: KeyboardEvent) {
  // Packaged app, so overriding the browser's native "close tab" is intentional
  // (same reasoning as Ctrl+F for the command palette).
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    open.value = !open.value
  }
}

const openViaEvent = () => (open.value = true)
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('devdesk:open-workspace-switcher', openViaEvent)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('devdesk:open-workspace-switcher', openViaEvent)
})
</script>

<template>
  <UModal v-model:open="open" title="Switch workspace" description="Ctrl+W">
    <template #content>
      <div class="p-2">
        <UListbox
          :model-value="activeWorkspaceId"
          :items="workspaces"
          label-key="name"
          value-key="id"
          autofocus
          @update:model-value="pick($event as string | undefined)"
        />
        <hr class="my-1 border-default" />
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated"
          @click="manage"
        >
          <UIcon name="i-lucide-settings" class="size-4" />
          Manage workspaces
        </button>
      </div>
    </template>
  </UModal>
</template>
