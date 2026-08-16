import type { TaskPriority, TaskStatus } from '@devdesk/shared'

/** A task parsed out of markdown, before it gets an id/workspace/position. */
export interface ParsedTask {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  tags: string[]
}

// A heading whose text names a board column sets the status for the items under it;
// any other heading becomes a tag instead.
const STATUS_BY_HEADING: Record<string, TaskStatus> = {
  backlog: 'backlog',
  todo: 'todo',
  'to do': 'todo',
  'to-do': 'todo',
  'in progress': 'in_progress',
  'in-progress': 'in_progress',
  doing: 'in_progress',
  wip: 'in_progress',
  done: 'done',
  complete: 'done',
  completed: 'done',
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/
// Bullet or ordered item, with an optional GFM checkbox.
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/

/**
 * Turn a markdown outline into tasks. Top-level list items become tasks; anything
 * indented under one (nested bullets, paragraphs) becomes that task's description.
 * `[x]` marks a task done, otherwise the enclosing heading decides the status.
 *
 * ponytail: no inline metadata syntax (`!high`, `@due`) — priority defaults to
 * medium and is edited on the card. Add a token pass here if imports need it.
 */
export function parseMarkdownTasks(markdown: string): ParsedTask[] {
  const tasks: ParsedTask[] = []
  const description: string[] = []
  let current: ParsedTask | null = null
  let currentIndent = 0
  let status: TaskStatus = 'todo'
  let tags: string[] = []

  // Attach the buffered description lines to the task they belong to, dedented as a
  // block so nested bullets keep their shape relative to each other.
  function close() {
    if (current) {
      const filled = description.filter((l) => l.trim())
      const dedent = Math.min(...filled.map((l) => l.length - l.trimStart().length), Infinity)
      current.description = description
        .map((l) => l.slice(dedent === Infinity ? 0 : dedent))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }
    description.length = 0
    current = null
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(HEADING)
    if (heading) {
      close()
      const text = (heading[2] ?? '').trim().replace(/[\s#:]+$/, '')
      const mapped = STATUS_BY_HEADING[text.toLowerCase()]
      status = mapped ?? 'todo'
      tags = mapped || !text ? [] : [text]
      continue
    }

    const item = line.match(LIST_ITEM)
    if (item) {
      const [, pad = '', checkbox, text = ''] = item
      const indent = pad.replace(/\t/g, '    ').length
      // Deeper than the task we're inside → it's a detail of that task, kept verbatim
      // (relative indentation and all) so it still renders as a nested list.
      if (current && indent > currentIndent) {
        description.push(line.trimEnd())
        continue
      }
      close()
      const title = text.trim()
      if (!title) continue
      current = {
        title,
        description: '',
        status: checkbox?.toLowerCase() === 'x' ? 'done' : status,
        priority: 'medium',
        tags: [...tags],
      }
      currentIndent = indent
      tasks.push(current)
      continue
    }

    if (!line.trim()) {
      if (current) description.push('')
      continue
    }
    if (current) description.push(line.trimEnd())
  }

  close()
  return tasks
}
