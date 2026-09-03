import { build } from 'esbuild'

/**
 * Bundled rather than compiled with tsc.
 *
 * Every other package here is source-linked TypeScript that Vite bundles for the
 * webview; `main` points at `src/index.ts`. `tsc` alone would emit JS importing
 * `@devdesk/tools`, which resolves to a `.ts` file Node cannot run — so this is the
 * one package in the repo that needs a real bundler. The result is a single
 * self-contained file, which is also what makes it usable as a `bin` from anywhere.
 */
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // The banner carries the shebang, so src/index.ts must not also have one — esbuild
  // emits the banner first and a second shebang on line 2 is a syntax error.
  //
  // It also defines `require`. node-forge calls `require('crypto')` at runtime, and
  // in an ESM bundle esbuild's shim cannot resolve a node builtin; createRequire
  // gives those calls a real one.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __devdeskCreateRequire } from 'node:module'",
      'const require = __devdeskCreateRequire(import.meta.url)',
    ].join('\n'),
  },
  sourcemap: true,
  logLevel: 'info',
})
