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
