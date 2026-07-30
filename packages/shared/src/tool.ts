import { z } from 'zod'
import { PrivacyLevel } from './privacy'

export const ToolCategory = z.enum([
  'json',
  'encoding',
  'crypto',
  'web',
  'development',
  'data-formats',
  'date-time',
  'networking',
  'images',
  'math',
])
export type ToolCategory = z.infer<typeof ToolCategory>

/** Static, serializable description of a tool plugin. Exported by each tool package. */
export interface ToolDefinition {
  id: string
  name: string
  description: string
  category: ToolCategory
  /** Optional sub-group within a category (e.g. "Generators" under Crypto). */
  group?: string
  route: string
  icon: string
  tags: string[]
  keywords: string[]
  shortcut?: string
  privacyLevel: PrivacyLevel
  supportsHistory: boolean
  supportsFavorites: boolean
  supportsNotes: boolean
  supportsSnippets: boolean
  isCore: boolean
  isImplemented: boolean
  /** Curated list position. Drives ordering in empty-query tool listings. Lower first. */
  order: number
}

/**
 * A runnable tool plugin: metadata + a validation schema + pure logic.
 * `run` may be async — most tools are pure sync transforms, but a few (hashing
 * via crypto.subtle) need a Promise. Callers should `await` the result.
 */
export interface ToolPlugin<Input = unknown, Output = unknown> {
  metadata: ToolDefinition
  schema: z.ZodType<Input>
  run: (input: Input) => Output | Promise<Output>
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  json: 'JSON',
  encoding: 'Encoding',
  crypto: 'Crypto',
  web: 'Web',
  development: 'Development',
  'data-formats': 'Data Formats',
  'date-time': 'Date & Time',
  networking: 'Networking',
  images: 'Images',
  math: 'Math',
}
