import { ref } from 'vue'
import { createEmitter } from '@devdesk/utils'
import type { EntityKind } from '@devdesk/shared'

/**
 * App-wide event bus. Features publish/subscribe here instead of importing each
 * other — this is the decoupling layer from the requirements' "Event System".
 * Example flow: a mutation emits `entity:mutated`, which the sync layer (Phase 8)
 * turns into a queued operation, while a toast handler shows feedback.
 */
// A type alias (not interface) so it satisfies the emitter's Record<string, unknown> constraint.
export type AppEvents = {
  'tool:opened': { toolId: string }
  'tool:executed': { toolId: string }
  'favorite:changed': { toolId: string; isFavorite: boolean }
  'entity:mutated': { kind: EntityKind; id: string; op: 'upsert' | 'delete' }
  toast: { type: 'info' | 'success' | 'error'; message: string }
  'edit-menu:open': { x: number; y: number; target: HTMLElement }
}

export const bus = createEmitter<AppEvents>()

/**
 * Cross-page "open this entity" request, set by the command palette and consumed
 * by the target feature page. A shared ref (not a bus event) so it works whether
 * the page is already mounted (watch fires) or mounts after navigation (immediate
 * watch reads it). `nonce` lets re-opening the same id refire the watch.
 */
export const openRequest = ref<{ kind: EntityKind; id: string; nonce: number } | null>(null)
