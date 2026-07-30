import type { ToolDefinition, ToolPlugin, ToolCategory } from '@devdesk/shared'

/**
 * The registry aggregates all tool plugins. Tools register here (Phase 6),
 * never hardcoded inside the desktop app. Placeholder "coming soon" tools are
 * plain metadata with no plugin behind them (isImplemented: false).
 */
const plugins = new Map<string, ToolPlugin>()
const definitions = new Map<string, ToolDefinition>()

/** Register a runnable tool. Its metadata replaces any placeholder with the same id. */
export function registerTool(plugin: ToolPlugin): void {
  if (plugins.has(plugin.metadata.id)) {
    throw new Error(`Duplicate tool implementation: ${plugin.metadata.id}`)
  }
  plugins.set(plugin.metadata.id, plugin)
  definitions.set(plugin.metadata.id, { ...plugin.metadata, isImplemented: true })
}

/** Register metadata for a not-yet-implemented tool. Never overrides a real plugin. */
export function registerPlaceholder(meta: ToolDefinition): void {
  if (plugins.has(meta.id)) return
  definitions.set(meta.id, { ...meta, isImplemented: false })
}

/**
 * Register a tool that is implemented by a UI component rather than a headless
 * plugin (canvas work, drag-and-drop files). It counts as implemented, but
 * getPlugin() returns nothing — the app renders its bespoke component instead.
 */
export function registerUiOnly(meta: ToolDefinition): void {
  if (plugins.has(meta.id)) return
  definitions.set(meta.id, { ...meta, isImplemented: true })
}

export const getPlugin = (id: string): ToolPlugin | undefined => plugins.get(id)
export const getTool = (id: string): ToolDefinition | undefined => definitions.get(id)
export const getToolByRoute = (route: string): ToolDefinition | undefined =>
  allTools().find((t) => t.route === route)

export const allTools = (): ToolDefinition[] => [...definitions.values()]
export const implementedTools = (): ToolDefinition[] =>
  allTools().filter((t) => t.isImplemented)
export const toolsByCategory = (category: ToolCategory): ToolDefinition[] =>
  allTools().filter((t) => t.category === category)

/** Test-only: wipe the registry between suites. */
export function _resetRegistry(): void {
  plugins.clear()
  definitions.clear()
}
