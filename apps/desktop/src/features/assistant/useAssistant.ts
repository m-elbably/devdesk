import { computed, ref } from 'vue'
import { runTurn, toolIdFor, type ChatMessage, type ModelMessage, type ToolCallRecord } from '@devdesk/ai'
import { createRepositories } from '@devdesk/database'
import { getTool } from '@devdesk/tools'
import { newId, nowIso } from '@devdesk/utils'
import {
  activeLocality,
  activeProvider,
  prepareOutbound,
  toolCap,
  uiHints,
  activeModel,
} from '@/services/ai'
import { bus } from '@/lib/events'

const repos = createRepositories()

export interface ContextItem {
  id: string
  label: string
  text: string
}

export function useAssistant() {
  const conversationId = ref(newId())
  const messages = ref<ChatMessage[]>([])
  const streaming = ref(false)
  const error = ref('')
  /** Tools used in this conversation. Kept in the belt so earlier turns stay legible. */
  const pinned = ref<string[]>([])
  /** Tools withheld from the last turn because the provider is remote. */
  const withheld = ref<{ id: string; name: string }[]>([])

  let controller: AbortController | null = null

  const canSend = computed(() => !streaming.value && activeProvider.value !== undefined)

  /**
   * Replay the conversation for the model.
   *
   * Only the text of each turn is replayed, not its tool calls. Tool results were
   * already folded into the assistant's own answer, and re-sending them would spend
   * the context budget twice on the same information — which matters most on the
   * small local models this is built around.
   */
  function toModelMessages(): ModelMessage[] {
    return messages.value
      .filter((message) => message.text.trim() !== '')
      .map((message) => ({
        role: message.role === 'system' ? 'assistant' : message.role,
        content: message.text,
      })) as ModelMessage[]
  }

  async function persist() {
    const provider = activeProvider.value
    if (!provider) return
    await repos.aiConversations.save({
      id: conversationId.value,
      title: messages.value[0]?.text.slice(0, 60) || 'New conversation',
      messages: messages.value,
      providerId: provider.id,
      model: provider.model,
    })
  }

  function reset() {
    cancel()
    conversationId.value = newId()
    messages.value = []
    pinned.value = []
    withheld.value = []
    error.value = ''
  }

  async function load(id: string) {
    const row = await repos.aiConversations.get(id)
    if (!row) return
    cancel()
    conversationId.value = row.id
    messages.value = row.messages as ChatMessage[]
    pinned.value = []
    error.value = ''
  }

  function cancel() {
    controller?.abort()
    controller = null
    streaming.value = false
  }

  async function send(input: string, context: ContextItem[] = []): Promise<void> {
    const trimmed = input.trim()
    if (trimmed === '' || streaming.value) return

    error.value = ''

    // Redaction is applied once, here, to everything that will be transmitted —
    // the question and any attached page context alike.
    const attached = context.map((item) => `${item.label}:\n${item.text}`).join('\n\n')
    const outbound = prepareOutbound(attached === '' ? trimmed : `${trimmed}\n\n${attached}`)

    messages.value.push({ id: newId(), role: 'user', text: outbound, createdAt: nowIso() })

    const assistant: ChatMessage = { id: newId(), role: 'assistant', text: '', toolCalls: [], createdAt: nowIso() }
    messages.value.push(assistant)

    streaming.value = true
    controller = new AbortController()

    try {
      const { model, locality } = await activeModel()
      const turn = runTurn({
        model,
        locality,
        messages: toModelMessages(),
        query: trimmed,
        pinned: pinned.value,
        toolCap: toolCap.value,
        uiHints,
        abortSignal: controller.signal,
        onStepError: (cause) => {
          error.value = cause instanceof Error ? cause.message : String(cause)
        },
      })

      withheld.value = turn.belt.withheld.map((entry) => ({ id: entry.id, name: entry.name }))

      for await (const part of turn.stream.fullStream) {
        if (part.type === 'text-delta') {
          assistant.text += part.text
        } else if (part.type === 'tool-call') {
          assistant.toolCalls?.push(recordFor(part.toolCallId, part.toolName, part.input))
          const toolId = toolIdFor(part.toolName)
          if (toolId && !pinned.value.includes(toolId)) pinned.value.push(toolId)
        } else if (part.type === 'tool-result') {
          const record = find(assistant, part.toolCallId, part.toolName, part.input)
          record.output = part.output
        } else if (part.type === 'tool-error') {
          const record = find(assistant, part.toolCallId, part.toolName, part.input)
          record.error = part.error instanceof Error ? part.error.message : String(part.error)
        } else if (part.type === 'error') {
          error.value = part.error instanceof Error ? part.error.message : String(part.error)
        }
      }

      // A model that ran a tool and then said nothing leaves a blank bubble, which
      // reads as a failure. The tool card is the answer in that case.
      if (assistant.text.trim() === '' && assistant.toolCalls?.length) {
        assistant.text = 'Ran the tool above — its result is the answer.'
      }
    } catch (cause) {
      if (isAbort(cause)) {
        assistant.text += assistant.text === '' ? 'Cancelled.' : '\n\n_Cancelled._'
      } else {
        error.value = cause instanceof Error ? cause.message : String(cause)
        bus.emit('toast', { type: 'error', message: error.value })
      }
    } finally {
      streaming.value = false
      controller = null
      await persist()
    }
  }

  return {
    conversationId,
    messages,
    streaming,
    error,
    withheld,
    pinned,
    canSend,
    locality: activeLocality,
    send,
    cancel,
    reset,
    load,
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))

function recordFor(toolCallId: string, toolName: string, input: unknown): ToolCallRecord {
  const toolId = toolIdFor(toolName)
  return {
    id: toolCallId,
    toolId: toolId ?? toolName,
    // The registry's own name, so a card says "JWT Parser" rather than "jwt_parser".
    toolName: (toolId ? getTool(toolId)?.name : undefined) ?? toolName,
    input,
    ranLocally: true,
  }
}

/** The record for a tool call, creating one if the result arrived without its call. */
function find(message: ChatMessage, toolCallId: string, toolName: string, input: unknown): ToolCallRecord {
  message.toolCalls ??= []
  const existing = message.toolCalls.find((record) => record.id === toolCallId)
  if (existing) return existing

  const created = recordFor(toolCallId, toolName, input)
  message.toolCalls.push(created)
  return created
}
