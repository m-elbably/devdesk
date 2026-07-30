<script setup lang="ts">
import { Calendar } from 'lucide-vue-next'
import type { Task } from '@devdesk/shared'
import MarkdownView from '@/components/MarkdownView.vue'

const props = defineProps<{ task: Task }>()
defineEmits<{ edit: []; toggle: [] }>()

type BadgeColor = 'neutral' | 'info' | 'warning' | 'error'
const priorityBadge: Record<string, { color: BadgeColor; variant: 'subtle' | 'soft' }> = {
  low: { color: 'neutral', variant: 'subtle' },
  medium: { color: 'info', variant: 'soft' },
  high: { color: 'warning', variant: 'soft' },
  urgent: { color: 'error', variant: 'soft' },
}

// Days between the due date and today, floored to whole days for a stable label.
function daysUntil(iso: string): number {
  const due = new Date(iso).setHours(0, 0, 0, 0)
  const today = new Date().setHours(0, 0, 0, 0)
  return Math.round((due - today) / 86_400_000)
}

function dueLabel(iso: string): string {
  const days = daysUntil(iso)
  if (days === 0) return 'Today'
  if (days === -1) return 'Yesterday'
  if (days === 1) return 'Tomorrow'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dueClass(iso: string): string {
  const days = daysUntil(iso)
  if (props.task.status === 'done') return 'text-default/40'
  return days < 0 ? 'text-error' : days === 0 ? 'text-warning' : 'text-default/50'
}
</script>

<template>
  <div
    class="rounded-lg bg-default border border-default cursor-default active:cursor-grabbing hover:border-primary transition-colors"
    role="button"
    tabindex="0"
    title="Click to edit; drag to move"
    :aria-label="`Edit task: ${task.title}`"
    @click="$emit('edit')"
    @keydown.enter="$emit('edit')"
    @keydown.space.prevent="$emit('edit')"
  >
    <div class="flex flex-col gap-2 p-3" :class="task.status === 'done' ? 'opacity-60' : ''">
      <div class="flex items-start justify-between gap-2">
        <!-- .stop so completing a task doesn't also open the edit dialog. -->
        <UCheckbox
          :model-value="task.status === 'done'"
          size="sm"
          class="mt-px shrink-0"
          :aria-label="task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`"
          @click.stop
          @update:model-value="$emit('toggle')"
        />
        <MarkdownView
          :source="task.title"
          class="flex-1 min-w-0 font-bold text-sm leading-snug [&_p]:m-0"
          :class="task.status === 'done' ? 'line-through' : ''"
        />
        <UBadge
          :color="priorityBadge[task.priority]?.color ?? 'neutral'"
          :variant="priorityBadge[task.priority]?.variant ?? 'subtle'"
          size="sm"
          class="shrink-0"
        >
          {{ task.priority }}
        </UBadge>
      </div>

      <MarkdownView
        v-if="task.description"
        :source="task.description"
        class="line-clamp-3 text-xs text-default/60 leading-snug"
      />

      <div v-if="task.tags?.length || task.dueDate" class="flex items-center justify-between pt-2 mt-1 border-t border-default/60">
        <div class="flex flex-wrap items-center gap-1">
          <UBadge v-for="tag in task.tags ?? []" :key="tag" color="primary" variant="soft" size="sm">{{ tag }}</UBadge>
        </div>
        <span v-if="task.dueDate" class="inline-flex items-center gap-1 text-xs shrink-0" :class="dueClass(task.dueDate)">
          <Calendar class="size-3" />{{ dueLabel(task.dueDate) }}
        </span>
      </div>
    </div>
  </div>
</template>
