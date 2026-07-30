import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Requirement: escape rendered Markdown / sanitize user HTML. marked handles the
// Markdown→HTML; DOMPurify strips anything dangerous (scripts, event handlers, etc.).
marked.setOptions({ gfm: true, breaks: true })

// Intercept ```mermaid fenced blocks and emit a <div class="mermaid"> that
// MarkdownView.vue picks up post-render to call mermaid.run() on. Everything
// else falls through to the default code renderer.
marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang === 'mermaid') {
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        return `<div class="mermaid">${escaped}</div>`
      }
      return false
    },
  },
})

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false })
  return DOMPurify.sanitize(raw)
}

export function hasMermaid(src: string): boolean {
  return /```mermaid\b/.test(src)
}
