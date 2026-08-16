import { describe, it, expect } from 'vitest'
import { parseMarkdownTasks } from './markdownTasks'

describe('parseMarkdownTasks', () => {
  it('reads checkboxes, headings and nested detail', () => {
    const tasks = parseMarkdownTasks(`
# Release notes

## In Progress

- [ ] Ship the importer
  - parse markdown
  - wire the dialog

  Needs a preview before it lands.

- [x] Write the parser

## Chores

1. Update the changelog
`)

    expect(tasks.map((t) => [t.title, t.status, t.tags])).toEqual([
      ['Ship the importer', 'in_progress', []],
      ['Write the parser', 'done', []],
      ['Update the changelog', 'todo', ['Chores']],
    ])
    expect(tasks[0]?.description).toBe(
      '- parse markdown\n- wire the dialog\n\nNeeds a preview before it lands.',
    )
    expect(tasks[1]?.description).toBe('')
  })

  it('defaults a plain list to todo and ignores prose without tasks', () => {
    expect(parseMarkdownTasks('- one\n* two\n+ three').map((t) => t.status)).toEqual([
      'todo',
      'todo',
      'todo',
    ])
    expect(parseMarkdownTasks('# Nothing here\n\nJust a paragraph.')).toEqual([])
  })
})
