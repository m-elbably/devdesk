import { registerTool, registerPlaceholder, registerUiOnly } from './registry'
import { CORE_TOOLS, COMING_SOON, UI_ONLY_TOOLS } from './catalog'
import { CORE_PLUGINS } from './tools'

/**
 * Populate the registry. Call once at app startup.
 *
 * Implemented plugins register first (isImplemented: true wins); any catalog entry
 * without a plugin, plus the roadmap tools, stay "coming soon" placeholders —
 * except UI-only tools, whose implementation is a Vue component this package
 * can't see, so they declare themselves implemented in the catalog.
 */
export function registerBuiltinTools(): void {
  for (const plugin of CORE_PLUGINS) registerTool(plugin)
  for (const meta of [...CORE_TOOLS, ...COMING_SOON]) {
    if (UI_ONLY_TOOLS.has(meta.id)) registerUiOnly(meta)
    else registerPlaceholder(meta)
  }
}
