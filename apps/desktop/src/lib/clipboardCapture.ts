export type CaptureKind = 'task' | 'note'

export interface ClipboardSuggestion {
  kind: CaptureKind
  label?: string
  path?: string
}

export function suggestClipboardCapture(value: string): ClipboardSuggestion {
  const text = value.trim()
  if (/^curl\s/i.test(text)) return { kind: 'note', label: 'Open cURL Converter', path: '/tools/web/curl' }
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) return { kind: 'note', label: 'Open JWT Parser', path: '/tools/crypto/jwt' }
  try {
    new URL(text)
    return { kind: 'task', label: 'Open URL Parser', path: '/tools/web/url-parser' }
  } catch {
    return { kind: 'task' }
  }
}
