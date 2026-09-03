import { z } from 'zod'

/**
 * Privacy level governs whether a tool's inputs/outputs may be persisted or synced.
 * - PUBLIC: safe to persist history and sync (e.g. JSON Editor)
 * - LOCAL_ONLY: may persist locally but never leaves the device (e.g. Password Generator)
 * - NEVER_PERSIST: never written to disk at all (e.g. JWT Parser)
 */
export const PrivacyLevel = z.enum(['PUBLIC', 'LOCAL_ONLY', 'NEVER_PERSIST'])
export type PrivacyLevel = z.infer<typeof PrivacyLevel>

export const canPersistHistory = (level: PrivacyLevel): boolean => level !== 'NEVER_PERSIST'
export const canSync = (level: PrivacyLevel): boolean => level === 'PUBLIC'

/**
 * Whether a tool may be offered to — and its inputs and outputs shown to — a model
 * running somewhere other than this machine.
 *
 * `LOCAL_ONLY` says the data never leaves the device and `NEVER_PERSIST` says it is
 * never even written down, so neither may be handed to a third-party API. Only
 * `PUBLIC` can. A model running locally is not "somewhere else" and is not gated by
 * this at all — see `localityOf` in `@devdesk/ai`, which decides that from the
 * provider's URL.
 */
export const canSendToRemoteModel = (level: PrivacyLevel): boolean => level === 'PUBLIC'
