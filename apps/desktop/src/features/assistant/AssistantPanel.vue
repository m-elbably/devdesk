<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErrorState } from '@devdesk/ui'
import { activeProvider, autodetectLocalProviders, isConfigured, loadProviders, usingNativeTransport } from '@/services/ai'
import { assistantOpen } from './state'
import { useAssistant, type ContextItem } from './useAssistant'
import { usePageContext } from './usePageContext'
import ContextChips from './ContextChips.vue'
import MessageList from './MessageList.vue'

const assistant = useAssistant()
const { available } = usePageContext()

const draft = ref('')
const attached = ref<string[]>([])
const detecting = ref(false)

const badge = computed(() => {
  const provider = activeProvider.value
  if (!provider) return { color: 'neutral' as const, label: 'No provider' }
  return assistant.locality.value === 'local'
    ? { color: 'success' as const, label: `Local · ${provider.model || provider.label}` }
    : { color: 'warning' as const, label: `Cloud · ${provider.label}` }
})

/**
 * Page context is refused for a remote provider rather than silently dropped.
 *
 * The chips advertise what this page could contribute; going quiet when the answer
 * is "not to a cloud model" would read as a bug, and worse, would leave the user
 * unsure whether it was sent.
 */
const contextBlocked = computed(() =>
  assistant.locality.value === 'remote' ? 'a cloud provider only receives what you type' : undefined,
)

const withheldSummary = computed(() => {
  const names = assistant.withheld.value.map((entry) => entry.name)
  if (names.length === 0) return ''
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown
})

onMounted(async () => {
  await loadProviders()
  if (isConfigured.value) return

  // First run: if LM Studio or Ollama is already running, just use it.
  detecting.value = true
  try {
    await autodetectLocalProviders()
  } finally {
    detecting.value = false
  }
})

function toggleContext(id: string) {
  attached.value = attached.value.includes(id)
    ? attached.value.filter((item) => item !== id)
    : [...attached.value, id]
}

async function submit() {
  const text = draft.value
  const context: ContextItem[] = contextBlocked.value
    ? []
    : available.value.filter((item) => attached.value.includes(item.id))

  draft.value = ''
  attached.value = []
  await assistant.send(text, context)
}

function onKeydown(event: KeyboardEvent) {
  // Enter sends; Shift+Enter is a newline. Matches every chat input a developer
  // already has muscle memory for.
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}
</script>

<template>
  <aside class="flex flex-col w-96 shrink-0 border-l border-default bg-default h-screen">
    <header class="flex items-center gap-2 h-14 px-3 border-b border-default shrink-0">
      <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
      <h2 class="font-semibold text-sm">Assistant</h2>
      <UBadge :color="badge.color" variant="subtle" size="sm" class="truncate">{{ badge.label }}</UBadge>
      <div class="ml-auto flex items-center gap-1 shrink-0">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-square-pen"
          title="New conversation"
          @click="assistant.reset()"
        />
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          title="Close (Ctrl+I)"
          @click="assistantOpen = false"
        />
      </div>
    </header>

    <div v-if="detecting" class="flex items-center gap-2 px-3 py-4 text-sm text-muted">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      Looking for a model on this machine…
    </div>

    <div v-else-if="!isConfigured" class="px-3 py-4 space-y-3 text-sm text-muted">
      <p class="font-medium text-default">No AI provider yet.</p>
      <p>
        Start <strong class="text-default">LM Studio</strong> or <strong class="text-default">Ollama</strong> and reopen
        this panel — DevDesk will find it and configure itself. Nothing you type will leave this machine.
      </p>
      <p>Prefer a cloud model? Add a provider and API key under Settings → AI assistant.</p>
      <p class="text-xs">
        A local model is offered every tool. A cloud provider is only offered the tools that cannot leak a secret.
      </p>
    </div>

    <template v-else>
      <div v-if="assistant.messages.value.length === 0" class="px-3 py-4 text-sm text-muted space-y-2">
        <p>Ask about anything in the toolbox. The assistant picks the tool and DevDesk runs it — the model never does the arithmetic itself.</p>
        <p class="text-xs">Try: “decode this JWT and tell me when it expires”, or “how many hosts fit in a /22?”</p>
      </div>

      <MessageList v-else :messages="assistant.messages.value" :streaming="assistant.streaming.value" />

      <div v-if="usingNativeTransport" class="px-3 py-1.5 text-xs text-muted border-t border-default">
        <UIcon name="i-lucide-info" class="size-3 inline-block mr-1" />
        Using the native transport — this provider blocks direct browser requests, so replies arrive all at once
        instead of streaming.
      </div>

      <div v-if="withheldSummary" class="px-3 py-1.5 text-xs text-muted border-t border-default">
        <UIcon name="i-lucide-shield" class="size-3 inline-block mr-1" />
        Withheld from this cloud provider: {{ withheldSummary }}.
      </div>

      <ErrorState v-if="assistant.error.value" :message="assistant.error.value" class="mx-3 my-2" />

      <div class="border-t border-default shrink-0">
        <ContextChips
          :available="available"
          :attached="attached"
          :blocked-reason="contextBlocked"
          @toggle="toggleContext"
        />
        <div class="p-3 pt-1 flex items-end gap-2">
          <UTextarea
            v-model="draft"
            :rows="2"
            autoresize
            :maxrows="8"
            class="flex-1"
            placeholder="Ask something… (Enter to send)"
            :disabled="assistant.streaming.value"
            @keydown="onKeydown"
          />
          <UButton
            v-if="assistant.streaming.value"
            color="neutral"
            variant="subtle"
            icon="i-lucide-square"
            title="Stop"
            @click="assistant.cancel()"
          />
          <UButton
            v-else
            color="primary"
            icon="i-lucide-arrow-up"
            :disabled="!assistant.canSend.value || draft.trim() === ''"
            title="Send"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </aside>
</template>
