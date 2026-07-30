<script setup lang="ts">
import type { Component } from 'vue'

// `fill` makes the page a full-height flex column so the slot can stretch to the
// viewport (used by tools with input/output editor panes).
// `compact` collapses the header into a single tight row (tool pages) instead of
// the taller two-row layout with a separate subtitle/toolbar band.
// `fluid` drops the centered max-width so the page uses the full window width.
defineProps<{ title: string; subtitle?: string; icon?: Component; fill?: boolean; compact?: boolean; fluid?: boolean }>()
</script>

<template>
  <div :class="[compact ? 'px-6 pb-6' : 'p-6', fluid ? 'w-full' : 'mx-auto max-w-7xl', fill ? 'h-full flex flex-col' : '']">
    <div
      v-if="title || subtitle || $slots.actions"
      class="flex flex-wrap items-center justify-between gap-3 shrink-0"
      :class="compact ? 'sticky top-0 z-10 -mx-6 mb-3 bg-default/95 px-6 py-1.5 backdrop-blur relative after:absolute after:bottom-0 after:left-[calc(50%-50vw)] after:right-[calc(50%-50vw)] after:h-px after:bg-border' : 'mb-6'"
    >
      <div class="flex items-center min-w-0" :class="compact ? 'gap-2' : 'gap-3'">
        <div
          v-if="icon"
          class="shrink-0"
          :class="compact ? 'rounded-lg border border-primary/20 bg-primary/10 p-1 text-primary' : 'text-primary'"
        >
          <component :is="icon" :class="compact ? 'size-4' : 'size-6'" />
        </div>
        <div class="min-w-0">
          <h1 :class="compact ? 'text-base font-semibold leading-tight truncate' : 'text-2xl font-bold'">{{ title }}</h1>
          <p v-if="subtitle && !compact" class="text-default/60 mt-1">{{ subtitle }}</p>
          <p v-else-if="subtitle" class="text-sm text-default/60 line-clamp-1">{{ subtitle }}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 ml-auto">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="fill" class="flex-1 min-h-0"><slot /></div>
    <slot v-else />
  </div>
</template>
