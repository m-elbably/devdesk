# Adding a tool plugin

A tool is **pure logic + metadata + a UI spec**. You never write a Vue component for a typical
tool — the generic `ToolRunner` renders it from a declarative spec. Adding one touches three
places and nothing in the core changes.

## 1. Metadata — `packages/tools/src/catalog.ts`

Add a `def({...})` entry to `CORE_TOOLS` (or push to `COMING_SOON` for a placeholder):

```ts
def({
  id: 'reverse-string',
  name: 'Reverse String',
  description: 'Reverse text, character by character.',
  category: 'development',
  path: 'reverse',           // route becomes /tools/development/reverse
  icon: 'flip-horizontal',
  privacy: 'PUBLIC',         // PUBLIC | LOCAL_ONLY | NEVER_PERSIST (default PUBLIC)
  keywords: ['reverse', 'string'],
})
```

`privacy` automatically decides history behavior — `NEVER_PERSIST` tools never hit disk.

## 2. Logic — `packages/tools/src/tools/<category>.ts`

Export a `ToolPlugin`: metadata (via `metaFor(id)`), a Zod `schema`, and a pure `run`. `run` may
be sync or async and must not touch the DOM, network, or Neutralino.

```ts
import { z } from 'zod'
import type { ToolPlugin } from '@devdesk/shared'
import { metaFor } from '../catalog'

const schema = z.object({ text: z.string() })

export const reverseString: ToolPlugin = {
  metadata: metaFor('reverse-string'),
  schema,
  run: (input) => schema.parse(input).text.split('').reverse().join(''),
}
```

Add it to the category's exported array (e.g. `developmentTools`). It's now registered by
`registerBuiltinTools()` — no wiring in the desktop app.

## 3. UI spec — `apps/desktop/src/tools/ui-spec.ts`

Describe the inputs and output shape. Field `name`s must match your schema keys.

```ts
'reverse-string': {
  fields: [{ kind: 'textarea', name: 'text', label: 'Text' }],
  output: 'text',   // text | code | json | svg | list | keyvalue
},
```

Field kinds: `text`, `textarea`, `number`, `select` (`options: [...]`), `checkbox`. Set
`manual: true` (with `actionLabel`) for generators that should run on a button press instead of live.

## 4. Test it

Add a case to `packages/tools/src/tools/tools.test.ts`:

```ts
expect(reverseString.run({ text: 'abc' })).toBe('cba')
```

That's it. The tool appears in its category page, global search, and the command palette, with
copy/clear buttons, favorites, "save output as snippet", and history — a "Recent runs" panel that
restores a past run's inputs. History and snippet-saving are both gated on privacy level, so a
`NEVER_PERSIST` tool gets neither and never touches disk.

## Need a custom UI?

If a tool truly needs a bespoke interface, add a component to
`apps/desktop/src/tools/components.ts` (`TOOL_COMPONENTS[id]`). `ToolPage` prefers a bespoke
component over the generic runner.
