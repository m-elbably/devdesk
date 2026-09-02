import type { Note, Snippet, Task, Workspace } from '@devdesk/shared'

const esc = (text: string) => text.replace(/([\\`*_{}\[\]<>()#+.!|-])/g, '\\$1')

function tags(tags: string[]): string {
  return tags.length ? ` — ${tags.map((tag) => `#${tag}`).join(' ')}` : ''
}

/** A readable, dependency-free export for moving one workspace to any Markdown app. */
export function exportWorkspaceMarkdown(workspace: Workspace, tasks: Task[], notes: Note[], snippets: Snippet[]): string {
  const lines = [`# ${workspace.name}`, '', `Exported ${new Date().toISOString()}`, '', '## Tasks', '']

  for (const task of tasks.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))) {
    const due = task.dueDate ? ` · due ${task.dueDate.slice(0, 10)}` : ''
    lines.push(`- [${task.status === 'done' ? 'x' : ' '}] ${esc(task.title)} (${task.status}, ${task.priority}${due})${tags(task.tags)}`)
    if (task.description) lines.push(`  ${task.description.replace(/\n/g, '\n  ')}`)
  }
  if (!tasks.length) lines.push('_No tasks._')

  lines.push('', '## Notes', '')
  for (const note of notes) {
    lines.push(`### ${note.title || 'Untitled note'}${tags(note.tags)}`, '', note.body || '_Empty note._', '')
  }
  if (!notes.length) lines.push('_No notes._', '')

  lines.push('## Snippets', '')
  for (const snippet of snippets) {
    lines.push(`### ${snippet.title || 'Untitled snippet'}${tags(snippet.tags)}`, '', `\`\`\`${snippet.language}`, snippet.code, '\`\`\`', '')
  }
  if (!snippets.length) lines.push('_No snippets._', '')

  return `${lines.join('\n').trimEnd()}\n`
}
