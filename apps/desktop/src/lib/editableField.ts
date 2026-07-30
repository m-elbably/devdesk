/**
 * Copy/paste/delete/select-all for the custom context menu, working on either a
 * native input/textarea (via selectionStart/End) or a contenteditable element
 * (CodeMirror's `.cm-content` included — it listens for real 'paste'/'keydown'
 * events on its content element, so dispatching synthetic ones drives it same
 * as a real clipboard action would).
 */
function isFieldLike(el: HTMLElement): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
}

export function getSelectionText(el: HTMLElement): string {
  if (isFieldLike(el)) return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
  return window.getSelection()?.toString() ?? ''
}

export function selectAll(el: HTMLElement) {
  if (isFieldLike(el)) {
    el.select()
    return
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export async function copySelection(el: HTMLElement) {
  const text = getSelectionText(el)
  if (text) await navigator.clipboard.writeText(text)
}

export async function pasteText(el: HTMLElement) {
  const text = await navigator.clipboard.readText()
  if (!text) return
  if (isFieldLike(el)) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start + text.length
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  const data = new DataTransfer()
  data.setData('text/plain', text)
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}

export function deleteSelection(el: HTMLElement) {
  if (isFieldLike(el)) {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start === end) return
    el.value = el.value.slice(0, start) + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }))
}
