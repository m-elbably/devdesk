import { computed, ref } from 'vue'
import { useRouterState } from '@tanstack/vue-router'
import { getToolByRoute } from '@devdesk/tools'
import type { ContextItem } from './useAssistant'

/**
 * What the current page is willing to contribute to a question.
 *
 * Nothing is read from a page unless that page has offered it, and nothing is sent
 * until the user clicks the chip. Two deliberate consequences: the assistant never
 * quietly harvests whatever is on screen, and a page that offers nothing shows no
 * chips rather than an empty promise.
 */
const offerings = ref<Map<string, ContextItem>>(new Map())

/**
 * Offer a piece of the current page to the assistant. Returns a function that
 * withdraws it, which a page calls on unmount so the offer does not outlive it.
 */
export function offerContext(item: ContextItem): () => void {
  offerings.value.set(item.id, item)
  offerings.value = new Map(offerings.value)
  return () => {
    offerings.value.delete(item.id)
    offerings.value = new Map(offerings.value)
  }
}

export function usePageContext() {
  const state = useRouterState()

  const available = computed<ContextItem[]>(() => {
    const offered = [...offerings.value.values()]
    // Name the tool the user is looking at, so "this page" is never ambiguous.
    const tool = getToolByRoute(state.value.location.pathname)
    return tool
      ? offered.map((item) => ({ ...item, label: item.label || tool.name }))
      : offered
  })

  return { available }
}
