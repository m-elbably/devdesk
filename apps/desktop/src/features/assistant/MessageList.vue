<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import MarkdownView from '@/components/MarkdownView.vue'
import type { ChatMessage } from '@devdesk/ai'
import ToolCallCard from './ToolCallCard.vue'

const props = defineProps<{ messages: ChatMessage[]; streaming: boolean }>()

const scroller = ref<HTMLElement | null>(null)
/**
 * Follow the stream, but stop the moment the user scrolls up to read something —
 * yanking the view back mid-sentence is worse than a stale scroll position.
 */
const following = ref(true)

function onScroll() {
  const el = scroller.value
  if (!el) return
  following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

watch(
  () => [props.messages.length, props.messages[props.messages.length - 1]?.text],
  async () => {
    if (!following.value) return
    await nextTick()
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <div ref="scroller" class="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-4" @scroll="onScroll">
    <div v-for="message in messages" :key="message.id" class="space-y-2">
      <div v-if="message.role === 'user'" class="flex justify-end">
        <div class="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {{ message.text }}
        </div>
      </div>

      <template v-else>
        <ToolCallCard v-for="call in message.toolCalls" :key="call.id" :call="call" />
        <MarkdownView v-if="message.text" :source="message.text" class="text-sm" />
        <div v-else-if="streaming" class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          Thinking…
        </div>
      </template>
    </div>
  </div>
</template>
