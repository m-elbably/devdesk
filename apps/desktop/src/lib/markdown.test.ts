import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders inline and block LaTeX with KaTeX', () => {
    const html = renderMarkdown('Mass $E=mc^2$ energy\n\n$$\n\\frac{a}{b}\n$$\n')
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
    // Sanitising must not strip KaTeX's MathML.
    expect(html).toContain('<math')
  })

  it('leaves a lone dollar sign alone', () => {
    expect(renderMarkdown('costs $5 today')).toContain('costs $5 today')
  })

  it('keeps mermaid blocks for MarkdownView to render', () => {
    expect(renderMarkdown('```mermaid\ngraph TD\nA-->B\n```')).toContain('<div class="mermaid">')
  })
})
