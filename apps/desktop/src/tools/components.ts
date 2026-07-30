import { defineAsyncComponent, type Component } from 'vue'

/**
 * Maps a tool id to its UI component. Tool *logic* lives in @devdesk/tools (pure,
 * headless); the *UI* lives here in the desktop app. Phase 6 fills this in — each
 * entry is a lazy import so a tool's UI only loads when opened.
 */
export const TOOL_COMPONENTS: Record<string, Component> = {
  'json-editor': defineAsyncComponent(() => import('@/components/JsonEditor.vue')),
  // These two outgrew the declarative ToolRunner: the regex tester needs a live
  // highlight layer over its input, and the cron generator a two-way expression
  // ⇄ field binding with a next-runs preview.
  'regex-tester': defineAsyncComponent(() => import('./RegexTester.vue')),
  'cron-generator': defineAsyncComponent(() => import('./CronGenerator.vue')),
  // Canvas pixels and drag-and-drop files: no headless plugin, the component is
  // the whole tool (marked uiOnly in the catalog).
  'gradient-generator': defineAsyncComponent(() => import('./GradientGenerator.vue')),
  'image-converter': defineAsyncComponent(() => import('./ImageConverter.vue')),
}
