<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from '@tanstack/vue-router'
import { getTool } from '@devdesk/tools'
import type { ToolCallRecord } from '@devdesk/ai'
import { assistantToolInput } from './toolHandoff'

const props = defineProps<{ call: ToolCallRecord }>()

const router = useRouter()
const tool = computed(() => getTool(props.call.toolId))
const failed = computed(() => props.call.error !== undefined)

const pretty = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

/**
 * Hand the same arguments to the real tool page.
 *
 * The input goes through a shared ref rather than the URL: tool inputs can be long
 * or contain secrets, and neither belongs in a route. ToolRunner picks it up on
 * mount or, if already mounted, on the watch.
 */
function openInTool() {
  const target = tool.value
  if (!target) return
  assistantToolInput.value = {
    toolId: target.id,
    input: props.call.input as Record<string, unknown>,
    nonce: Date.now(),
  }
  void router.navigate({ to: target.route })
}
</script>

<template>
  <div class="rounded-md border text-sm" :class="failed ? 'border-error/40 bg-error/5' : 'border-default bg-elevated/50'">
    <div class="flex items-center gap-2 px-3 py-2">
      <UIcon :name="failed ? 'i-lucide-alert-circle' : 'i-lucide-wrench'" class="size-4 shrink-0" :class="failed ? 'text-error' : 'text-primary'" />
      <span class="font-medium truncate">{{ call.toolName }}</span>
      <UBadge color="success" variant="subtle" size="sm" class="shrink-0">ran locally</UBadge>
      <UButton
        v-if="tool"
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-external-link"
        class="ml-auto shrink-0"
        title="Open in tool"
        @click="openInTool"
      >
        Open in tool
      </UButton>
    </div>

    <div class="px-3 pb-3 space-y-2">
      <div>
        <p class="text-xs text-dimmed mb-1">Arguments</p>
        <pre class="text-xs bg-default rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ pretty(call.input) }}</pre>
      </div>
      <div v-if="call.error">
        <p class="text-xs text-dimmed mb-1">Error</p>
        <pre class="text-xs text-error bg-default rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ call.error }}</pre>
      </div>
      <div v-else-if="call.output !== undefined">
        <p class="text-xs text-dimmed mb-1">Result</p>
        <pre class="text-xs bg-default rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ pretty(call.output) }}</pre>
      </div>
      <p v-else class="text-xs text-dimmed">Running…</p>
    </div>
  </div>
</template>
