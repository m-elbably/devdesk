/** Minimal typed pub/sub. No wildcards, no once — add them if a real need appears. */
export type Emitter<Events extends Record<string, unknown>> = {
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void
  emit<K extends keyof Events>(event: K, payload: Events[K]): void
}

export function createEmitter<Events extends Record<string, unknown>>(): Emitter<Events> {
  const handlers = new Map<keyof Events, Set<(payload: never) => void>>()
  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set()
      set.add(handler as (p: never) => void)
      handlers.set(event, set)
      return () => set.delete(handler as (p: never) => void)
    },
    emit(event, payload) {
      handlers.get(event)?.forEach((h) => (h as (p: Events[typeof event]) => void)(payload))
    },
  }
}
