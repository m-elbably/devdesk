<script setup lang="ts">
import { computed } from 'vue'
import { Calendar } from 'lucide-vue-next'
import type { Task } from '@devdesk/shared'
import MarkdownView from '@/components/MarkdownView.vue'

const props = defineProps<{
  task: Task
  selected: boolean
  selectedCount: number
  canMoveUp: boolean
  canMoveDown: boolean
}>()
const emit = defineEmits<{ edit: []; select: []; view: []; move: [delta: number]; remove: [] }>()

// Right-click menu. Nested arrays are Nuxt UI's group syntax — they render as separated
// sections, which keeps the destructive action away from the rest.
const menuItems = computed(() => [
  [
    { label: 'View', icon: 'i-lucide-eye', onSelect: () => emit('view') },
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => emit('edit') },
  ],
  [
    { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: !props.canMoveUp, onSelect: () => emit('move', -1) },
    { label: 'Move down', icon: 'i-lucide-arrow-down', disabled: !props.canMoveDown, onSelect: () => emit('move', 1) },
  ],
  [
    {
      label: props.selected && props.selectedCount > 1 ? `Delete ${props.selectedCount} tasks` : 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => emit('remove'),
    },
  ],
])

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
  return days < 0 ? 'text-error' : days === 0 ? 'text-warning' : 'text-default/50'
}
</script>

<template>
  <UContextMenu :items="menuItems">
    <div
      data-context-menu
      class="rounded-lg bg-default border cursor-default select-none active:cursor-grabbing transition-colors"
      :class="selected ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary'"
      role="button"
      tabindex="0"
      title="Double-click to view; drag to move; right-click for more"
      :aria-label="`View task: ${task.title}`"
      @dblclick="emit('view')"
      @keydown.enter="emit('view')"
      @keydown.space.prevent="emit('view')"
    >
      <div class="flex flex-col gap-2 p-3">
        <div class="flex items-start justify-between gap-2">
          <!-- .stop so selecting a task doesn't also open the edit dialog. -->
          <UCheckbox
            :model-value="selected"
            size="sm"
            class="mt-px shrink-0"
            :aria-label="`Select ${task.title}`"
            @click.stop
            @update:model-value="emit('select')"
          />
          <MarkdownView
            :source="task.title"
            class="flex-1 min-w-0 font-bold text-sm leading-snug [&_p]:m-0"
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
  </UContextMenu>
</template>
