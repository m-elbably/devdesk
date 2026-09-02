import { marked } from 'marked'
import katex from 'katex'
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

// $inline$ / $$block$$ LaTeX, matching what the editor's Mathematics extension
// writes. KaTeX renders bad input as red text rather than throwing.
const render = (latex: string, displayMode: boolean) => katex.renderToString(latex, { displayMode, throwOnError: false })
marked.use({
  extensions: [
    {
      name: 'blockMath', level: 'block',
      start: (src: string) => src.indexOf('$$'),
      tokenizer(src: string) {
        const match = /^\$\$([^$]+)\$\$/.exec(src)
        return match ? { type: 'blockMath', raw: match[0], text: match[1]!.trim() } : undefined
      },
      renderer: (token) => `<p>${render(token.text, true)}</p>`,
    },
    {
      name: 'inlineMath', level: 'inline',
      start: (src: string) => src.indexOf('$'),
      tokenizer(src: string) {
        const match = /^\$([^$\n]+)\$/.exec(src)
        return match ? { type: 'inlineMath', raw: match[0], text: match[1] } : undefined
      },
      renderer: (token) => render(token.text, false),
    },
  ],
})

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false })
  return DOMPurify.sanitize(raw)
}

export function hasMermaid(src: string): boolean {
  return /```mermaid\b/.test(src)
}
