<script setup lang="ts">
import { Link } from '@tanstack/vue-router'
import type { ToolDefinition } from '@devdesk/shared'
import { PrivacyBadge } from '@devdesk/ui'
import { CATEGORY_ICONS, TOOL_ICONS } from '@/lib/navigation'

const props = defineProps<{ tool: ToolDefinition }>()
const icon = TOOL_ICONS[props.tool.id] ?? CATEGORY_ICONS[props.tool.category]
</script>

<template>
  <component
    :is="tool.isImplemented ? Link : 'div'"
    :to="tool.isImplemented ? tool.route : undefined"
    class="rounded-lg border border-default bg-default transition-all"
    :class="
      tool.isImplemented
        ? 'hover:border-primary hover:shadow-md cursor-pointer'
        : 'opacity-60 cursor-not-allowed'
    "
  >
    <div class="p-4 flex flex-col gap-3">
      <div class="flex items-start gap-3">
        <div class="shrink-0 rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
          <component :is="icon" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="font-medium text-default truncate">{{ tool.name }}</h3>
          <p class="text-sm text-muted line-clamp-2 mt-0.5">{{ tool.description }}</p>
        </div>
        <UBadge v-if="!tool.isImplemented" color="neutral" variant="soft" size="sm" class="shrink-0">Soon</UBadge>
        <PrivacyBadge v-else-if="tool.privacyLevel !== 'PUBLIC'" :level="tool.privacyLevel" class="shrink-0" />
      </div>
      <div v-if="tool.tags.length" class="flex flex-wrap gap-1">
        <UBadge v-for="tag in tool.tags.slice(0, 3)" :key="tag" color="neutral" variant="subtle" size="sm">{{ tag }}</UBadge>
      </div>
    </div>
  </component>
</template>
