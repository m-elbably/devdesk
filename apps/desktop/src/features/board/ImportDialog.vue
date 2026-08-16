<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseModal, ErrorState } from '@devdesk/ui'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { desktop } from '@/services/desktop'
import { parseMarkdownTasks, type ParsedTask } from './markdownTasks'

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; import: [tasks: ParsedTask[]] }>()

// The markdown itself is the state: the file and clipboard buttons just fill it in,
// so the user can review and edit before anything gets created.
const markdown = ref('')
const error = ref('')

const parsed = computed(() => parseMarkdownTasks(markdown.value))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    markdown.value = ''
    error.value = ''
  },
)

async function loadFile() {
  error.value = ''
  try {
    const text = await desktop.openTextFile({ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] })
    if (text !== null) markdown.value = text
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadClipboard() {
  error.value = ''
  try {
    markdown.value = await navigator.clipboard.readText()
  } catch {
    error.value = 'Clipboard read was blocked. Paste into the editor below instead.'
  }
}

function submit() {
  if (!parsed.value.length) return
  emit('import', parsed.value)
}
</script>

<template>
  <BaseModal :open="open" title="Import tasks from markdown" box-class="max-w-3xl w-full" @close="emit('close')">
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-file-text" @click="loadFile">
          From file
        </UButton>
        <UButton color="neutral" variant="subtle" size="sm" icon="i-lucide-clipboard-paste" @click="loadClipboard">
          From clipboard
        </UButton>
      </div>

      <MarkdownEditor
        v-model="markdown"
        placeholder="- [ ] Paste or type a markdown checklist here"
        class="h-64"
      />

      <ErrorState v-if="error" :message="error" />

      <div v-if="parsed.length" class="max-h-48 overflow-y-auto rounded-lg border border-default bg-default p-2">
        <p class="px-1 pb-2 text-xs text-default/60">{{ parsed.length }} task(s) will be created:</p>
        <ul class="space-y-1">
          <li v-for="(task, i) in parsed" :key="i" class="px-1 text-sm">
            <div class="flex items-center gap-2">
              <UBadge color="neutral" variant="subtle" size="sm" class="shrink-0">
                {{ STATUS_LABEL[task.status] }}
              </UBadge>
              <span class="truncate">{{ task.title }}</span>
              <UBadge v-for="tag in task.tags" :key="tag" color="primary" variant="soft" size="sm" class="shrink-0">
                {{ tag }}
              </UBadge>
            </div>
            <!-- Descriptions are parsed but invisible otherwise, so the preview shows
                 a one-line trace of what got attached to each task. -->
            <p v-if="task.description" class="truncate pl-1 text-xs text-default/50">
              {{ task.description.replace(/\s+/g, ' ') }}
            </p>
          </li>
        </ul>
      </div>
      <p v-else-if="markdown.trim()" class="text-sm text-default/60">
        No list items found — tasks come from lines starting with <code>-</code>, <code>*</code> or <code>1.</code>
      </p>
    </div>

    <!-- #footer, not #actions: actions render up in the header next to the close button. -->
    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <span class="text-xs text-default/50">
          List items become tasks; indented lines under one become its description;
          <code>[x]</code> marks done; headings set the column or a tag.
        </span>
        <div class="flex shrink-0 gap-2">
          <UButton color="neutral" variant="ghost" size="sm" @click="emit('close')">Cancel</UButton>
          <UButton color="primary" size="sm" :disabled="!parsed.length" @click="submit">
            Import {{ parsed.length || '' }}
          </UButton>
        </div>
      </div>
    </template>
  </BaseModal>
</template>
