import { ref } from 'vue'

/**
 * Arguments handed from an assistant tool card to the real tool page.
 *
 * A shared ref rather than a bus event, for the same reason `openRequest` in
 * `lib/events.ts` is one: it has to work whether the tool page is already mounted
 * (the watch fires) or mounts after navigation (an immediate watch reads it). The
 * `nonce` lets the same tool be opened twice in a row and still refire.
 *
 * Not in `lib/events.ts` itself because that module is imported at startup and this
 * belongs to the assistant feature.
 */
export const assistantToolInput = ref<{
  toolId: string
  input: Record<string, unknown>
  nonce: number
} | null>(null)
