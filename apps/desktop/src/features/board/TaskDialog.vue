<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Task, TaskStatus, TaskPriority } from '@devdesk/shared'
import { BaseModal, ErrorState } from '@devdesk/ui'
import RichMarkdownEditor from '@/components/RichMarkdownEditor.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import { services } from '@/services'

const STATUS_OPTIONS = [
  { label: 'Backlog', value: 'backlog' },
  { label: 'Todo', value: 'todo' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
]
const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]

const props = defineProps<{ open: boolean; task: Task | null; defaultStatus?: TaskStatus }>()
const emit = defineEmits<{ close: [] }>()

// Local editable form, seeded whenever the dialog opens.
const title = ref('')
const description = ref('')
const status = ref<TaskStatus>('todo')
const priority = ref<TaskPriority>('medium')
const tags = ref('')
const dueDate = ref('')
const descMode = ref<'edit' | 'view'>('edit')
const busy = ref(false)
const error = ref('')
const confirmDelete = ref(false)

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time — toISOString() would
// shift by the timezone offset, so this formats the Date's local fields directly.
function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const t = props.task
    title.value = t?.title ?? ''
    description.value = t?.description ?? ''
    status.value = t?.status ?? props.defaultStatus ?? 'todo'
    priority.value = t?.priority ?? 'medium'
    tags.value = (t?.tags ?? []).join(', ')
    dueDate.value = t?.dueDate ? toDatetimeLocal(t.dueDate) : ''
    descMode.value = 'edit'
    error.value = ''
  },
)

async function save() {
  if (!title.value.trim()) return
  const data = {
    title: title.value.trim(),
    description: description.value,
    status: status.value,
    priority: priority.value,
    tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean),
    dueDate: dueDate.value ? new Date(dueDate.value).toISOString() : null,
  }
  busy.value = true
  error.value = ''
  try {
    if (props.task) await services.tasks.update(props.task.id, data as never)
    else await services.tasks.create(data as never)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.task) return
  confirmDelete.value = false
  busy.value = true
  error.value = ''
  try {
    await services.tasks.remove(props.task.id)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :open="open" :title="task ? 'Edit task' : 'New task'" box-class="max-w-3xl w-full" @close="emit('close')">
    <form class="space-y-3" @submit.prevent="save">
      <UFormField label="Title">
        <UInput v-model="title" class="w-full" placeholder="Task title" required autofocus />
      </UFormField>
      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium text-default">Description</span>
          <UFieldGroup size="xs">
            <UButton
              type="button"
              color="neutral"
              :variant="descMode === 'edit' ? 'solid' : 'ghost'"
              icon="i-lucide-pencil"
              @click="descMode = 'edit'"
            >
              Edit
            </UButton>
            <UButton
              type="button"
              color="neutral"
              :variant="descMode === 'view' ? 'solid' : 'ghost'"
              icon="i-lucide-eye"
              @click="descMode = 'view'"
            >
              View
            </UButton>
          </UFieldGroup>
        </div>
        <RichMarkdownEditor v-if="descMode === 'edit'" v-model="description" placeholder="Description" class="h-72" />
        <MarkdownView
          v-else
          :source="description || '_No description_'"
          class="h-72 overflow-y-auto rounded-lg border border-default bg-default p-3"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Status">
          <USelect v-model="status" :items="STATUS_OPTIONS" class="w-full" />
        </UFormField>
        <UFormField label="Priority">
          <USelect v-model="priority" :items="PRIORITY_OPTIONS" class="w-full" />
        </UFormField>
      </div>
      <UFormField label="Tags">
        <UInput v-model="tags" class="w-full" placeholder="Comma separated" />
      </UFormField>
      <UFormField label="Due date">
        <UInput v-model="dueDate" type="datetime-local" class="w-full" />
      </UFormField>

      <ErrorState v-if="error" :message="error" />

      <div class="flex justify-between pt-2">
        <UButton v-if="task" type="button" color="error" variant="ghost" size="sm" :disabled="busy" @click="confirmDelete = true">
          Delete
        </UButton>
        <div class="flex gap-2 ml-auto">
          <UButton type="button" color="neutral" variant="ghost" size="sm" @click="emit('close')">Cancel</UButton>
          <UButton type="submit" color="primary" size="sm" :loading="busy">Save</UButton>
        </div>
      </div>
    </form>
  </BaseModal>

  <BaseModal :open="confirmDelete" title="Delete task" box-class="max-w-sm w-full" @close="confirmDelete = false">
    <p class="text-sm text-muted">Delete “{{ task?.title }}”? This can’t be undone.</p>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" size="sm" @click="confirmDelete = false">Cancel</UButton>
        <UButton color="error" size="sm" :loading="busy" @click="remove">Delete</UButton>
      </div>
    </template>
  </BaseModal>
</template>
