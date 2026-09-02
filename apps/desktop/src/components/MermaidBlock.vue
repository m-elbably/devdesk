<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import MarkdownView from './MarkdownView.vue'

// Node view for code blocks: ```mermaid renders as a diagram, every other
// language stays a plain code block.
const props = defineProps(nodeViewProps)
const shown = ref(false)
const isMermaid = computed(() => props.node.attrs.language === 'mermaid')
const markdown = computed(() => `\`\`\`mermaid\n${props.node.textContent}\n\`\`\``)

// The source has to be showing whenever the caret is in the block, or a diagram
// could never be written in the first place: the rendered view is not editable,
// so replacing the code with it as soon as the block exists leaves nowhere to
// type. An unfocused editor has a caret too — a note that opens on a diagram
// must still show the diagram — so this only counts while the editor has focus.
const caretInside = ref(false)
function syncCaret() {
  const pos = props.getPos()
  const { from, to } = props.editor.state.selection
  caretInside.value = props.editor.isFocused && typeof pos === 'number' && to > pos && from < pos + props.node.nodeSize
}
const onBlur = () => (caretInside.value = false)
syncCaret()
props.editor.on('selectionUpdate', syncCaret)
props.editor.on('focus', syncCaret)
props.editor.on('blur', onBlur)
onBeforeUnmount(() => {
  props.editor.off('selectionUpdate', syncCaret)
  props.editor.off('focus', syncCaret)
  props.editor.off('blur', onBlur)
})

const source = computed(() => shown.value || caretInside.value)
const diagram = computed(() => isMermaid.value && !source.value)
</script>

<template>
  <NodeViewWrapper class="relative">
    <UButton
      v-if="isMermaid"
      contenteditable="false"
      size="xs" color="neutral" variant="ghost" square
      :icon="source ? 'i-lucide-eye' : 'i-lucide-pencil'"
      :aria-label="source ? 'Show diagram' : 'Edit diagram source'"
      class="absolute right-1 top-1 z-10"
      @click="shown = !source"
    />
    <!-- v-if, not v-show: mermaid measures label widths at render time and needs
         a laid-out container, so the view has to mount visible. -->
    <div v-if="diagram" contenteditable="false" class="rounded-md border border-muted bg-muted p-3">
      <MarkdownView :source="markdown" open />
    </div>
    <pre v-show="!diagram"><NodeViewContent as="code" /></pre>
  </NodeViewWrapper>
</template>
