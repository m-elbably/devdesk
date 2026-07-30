import { describe, it, expect, beforeEach } from 'vitest'
import { _resetRegistry, registerBuiltinTools, searchTools, allTools, CORE_PLUGINS, UI_ONLY_TOOLS } from './index'

beforeEach(() => {
  _resetRegistry()
  registerBuiltinTools()
})

describe('tool catalog + search', () => {
  it('registers the full core catalog', () => {
    expect(allTools().length).toBeGreaterThanOrEqual(30)
  })

  it('finds tools by fuzzy name and keyword', () => {
    expect(searchTools('json diff')[0]?.id).toBe('json-diff')
    expect(searchTools('guid')[0]?.id).toBe('uuid') // matched via keyword
    expect(searchTools('zzzznomatch')).toHaveLength(0)
  })

  it('filters by category', () => {
    const json = searchTools('', { category: 'json' })
    expect(json.length).toBe(3)
    expect(json.every((t) => t.category === 'json')).toBe(true)
  })

  it('lists the JSON Editor first in the JSON category', () => {
    const json = searchTools('', { category: 'json' })
    expect(json[0]?.id).toBe('json-editor')
  })

  it('can exclude placeholders', () => {
    // Core tools are implemented; only the roadmap "coming soon" entries are placeholders.
    // Derived from the registered set rather than a hardcoded count: the invariant
    // worth holding is "every headless plugin plus every UI-only tool surfaces as
    // implemented, and nothing else does" — a literal number just breaks on every
    // tool anyone adds. UI-only tools (canvas/file work) have no plugin but count.
    const implemented = searchTools('', { includePlaceholders: false })
    const expected = [...CORE_PLUGINS.map((p) => p.metadata.id), ...UI_ONLY_TOOLS].sort()
    expect(implemented.length).toBe(expected.length)
    expect(implemented.every((t) => t.isImplemented)).toBe(true)
    expect([...implemented].map((t) => t.id).sort()).toEqual(expected)
  })
})
