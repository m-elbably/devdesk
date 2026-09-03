import { db, type DevDeskDB } from '@devdesk/database'
import type { Note, Snippet } from '@devdesk/shared'
import { nowIso } from '@devdesk/utils'
import { bus } from './events'

/** A Markdown fence must be longer than any run in its source to stay unambiguous. */
export function snippetMarkdown(language: string, code: string): string {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language === 'text' ? '' : language}\n${code}\n${fence}`
}

/**
 * Moves legacy snippets into Notes without generating new IDs, so pins, deep links,
 * and synced change history survive. Running it after every pull also absorbs writes
 * from an older desktop client. The newest content wins under the existing LWW rule.
 */
export async function migrateLegacySnippets(source: DevDeskDB = db): Promise<number> {
  const snippets = await source.snippets.filter((snippet) => snippet.deletedAt === null).toArray()
  const changed: { kind: 'note' | 'snippet' | 'workspace'; id: string; op: 'upsert' | 'delete' }[] = []

  await source.transaction('rw', source.notes, source.snippets, source.workspaces, async () => {
    for (const snippet of snippets) {
      const note = await source.notes.get(snippet.id)
      if (!note || snippet.updatedAt > note.updatedAt) {
        const converted: Note = {
          id: snippet.id,
          workspaceId: snippet.workspaceId,
          userId: snippet.userId,
          revision: snippet.revision,
          createdAt: snippet.createdAt,
          updatedAt: snippet.updatedAt,
          deletedAt: null,
          title: snippet.title,
          body: snippetMarkdown(snippet.language, snippet.code),
          tags: snippet.tags,
          taskId: snippet.taskId,
          notebookId: null,
          isProtected: false,
          encrypted: null,
        }
        await source.notes.put(converted)
        changed.push({ kind: 'note', id: snippet.id, op: 'upsert' })
      }

      const now = nowIso()
      await source.snippets.put({ ...snippet, deletedAt: now, updatedAt: now, revision: snippet.revision + 1 } as Snippet)
      changed.push({ kind: 'snippet', id: snippet.id, op: 'delete' })

      const workspace = await source.workspaces.get(snippet.workspaceId)
      if (workspace?.home?.snippetIds.includes(snippet.id)) {
        await source.workspaces.put({
          ...workspace,
          home: {
            toolIds: workspace.home.toolIds,
            noteIds: [...new Set([...workspace.home.noteIds, snippet.id])],
            snippetIds: workspace.home.snippetIds.filter((id) => id !== snippet.id),
          },
          updatedAt: now,
          revision: workspace.revision + 1,
        })
        changed.push({ kind: 'workspace', id: workspace.id, op: 'upsert' })
      }
    }
  })

  for (const event of changed) bus.emit('entity:mutated', event)
  return snippets.length
}
