<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { services } from '@/services'
import { bus } from '@/lib/events'

type CaptureKind = 'task' | 'note' | 'snippet'

const open = ref(false)
const kind = ref<CaptureKind>('task')
const text = ref('')
const saving = ref(false)

const labels: Record<CaptureKind, string> = { task: 'Task', note: 'Note', snippet: 'Snippet' }

function show() {
  open.value = true
}

function close() {
  open.value = false
  text.value = ''
}

function splitText(value: string): [string, string] {
  const [first = '', ...rest] = value.trim().split('\n')
  return [first, rest.join('\n').trim()]
}

async function save() {
  if (!text.value.trim() || saving.value) return
  saving.value = true
  try {
    const [title, body] = splitText(text.value)
    if (kind.value === 'task') await services.tasks.create({ title, description: body } as never)
    else if (kind.value === 'note') await services.notes.create({ title, body } as never)
    else await services.snippets.create({ title: title || 'Untitled snippet', code: text.value.trim(), language: 'text' } as never)
    bus.emit('toast', { type: 'success', message: `${labels[kind.value]} captured.` })
    close()
  } catch (e) {
    bus.emit('toast', { type: 'error', message: e instanceof Error ? e.message : 'Capture failed.' })
  } finally {
    saving.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space') {
    event.preventDefault()
    show()
  }
}
const showViaEvent = () => show()
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('devdesk:quick-capture', showViaEvent)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('devdesk:quick-capture', showViaEvent)
})
</script>

<template>
  <UModal v-model:open="open" title="Quick capture" description="Saved to the active workspace." :ui="{ content: 'sm:max-w-xl' }">
    <template #content>
      <form class="p-5" @submit.prevent="save">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">Quick capture</h2>
            <p class="text-sm text-muted">First line is the title; the rest is the detail.</p>
          </div>
          <UButton color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Close quick capture" @click="close" />
        </div>
        <UFieldGroup class="mt-4">
          <UButton v-for="item in (['task', 'note', 'snippet'] as CaptureKind[])" :key="item" type="button" color="neutral" :variant="kind === item ? 'solid' : 'outline'" @click="kind = item">
            {{ labels[item] }}
          </UButton>
        </UFieldGroup>
        <textarea
          v-model="text"
          autofocus
          rows="7"
          class="mt-4 w-full resize-y rounded-md border border-default bg-default p-3 text-sm outline-none focus:border-primary"
          :placeholder="kind === 'snippet' ? 'Paste code or text…' : 'Title\nOptional details…'"
          @keydown.meta.enter.prevent="save"
          @keydown.ctrl.enter.prevent="save"
        />
        <div class="mt-4 flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" @click="close">Cancel</UButton>
          <UButton type="submit" color="primary" :loading="saving" :disabled="!text.trim()">Save {{ labels[kind] }}</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
