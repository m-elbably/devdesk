<script setup lang="ts">
import { computed } from 'vue'
import { BaseModal, CopyButton } from '@devdesk/ui'
import MarkdownView from '@/components/MarkdownView.vue'
import { TOOL_INFO } from '@/tools/info'

const props = defineProps<{ toolId: string | null; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const content = computed(() => (props.toolId ? TOOL_INFO[props.toolId] : ''))
</script>

<template>
  <BaseModal :open="open && !!content" title="Tool Info" box-class="max-w-3xl w-full" @close="emit('close')">
    <template #actions>
      <CopyButton :value="content ?? ''" />
    </template>
    <div class="max-h-[70vh] overflow-y-auto pr-3 pl-1">
      <MarkdownView v-if="content" :source="content" :open="open" />
    </div>
  </BaseModal>
</template>
